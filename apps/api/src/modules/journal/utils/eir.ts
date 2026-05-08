import { Decimal } from '@prisma/client/runtime/library';

/**
 * EIR (Effective Interest Rate) utilities for TFRS 15 §60-65 compliance.
 *
 * Used by 2A (InstallmentAccrual), JP4 (EarlyPayoff), JP5 (Repossession)
 * to allocate interest income per declining balance method instead of
 * straight-line.
 *
 * Refs:
 * - docs/accounting/eir-decision-memo.md
 * - TFRS 15 ย่อหน้า 60-65 (Significant Financing Component)
 */

export interface EIRPeriod {
  period: number;            // 1-indexed
  openingPrincipal: Decimal;  // balance at start of period
  interest: Decimal;          // interest accrued this period
  principalPayment: Decimal;  // principal portion of payment
  closingPrincipal: Decimal;  // balance at end of period
}

export interface EIRSolverOptions {
  guess?: number;        // initial r guess (default 0.01)
  tolerance?: number;    // convergence tolerance (default 1e-12)
  maxIterations?: number; // default 200
}

/**
 * Solve for monthly effective interest rate using Newton-Raphson.
 * Equation: P = PMT × (1 - (1+r)^-n) / r
 *
 * @returns monthly rate as Decimal (e.g., 0.074 for 7.4% per month)
 * @throws if convergence not achieved within maxIterations
 */
export function solveMonthlyEIR(
  principal: Decimal,
  monthlyPayment: Decimal,
  n: number,
  options: EIRSolverOptions = {},
): Decimal {
  const { guess = 0.01, tolerance = 1e-12, maxIterations = 200 } = options;

  if (n <= 0) throw new Error('n must be positive');
  if (principal.lte(0)) throw new Error('principal must be positive');
  if (monthlyPayment.lte(0)) throw new Error('monthlyPayment must be positive');

  // Sanity: total payments should exceed principal (otherwise no interest)
  const totalPayments = monthlyPayment.mul(n);
  if (totalPayments.lte(principal)) {
    throw new Error('totalPayments must exceed principal for EIR to be positive');
  }

  const P = parseFloat(principal.toString());
  const PMT = parseFloat(monthlyPayment.toString());

  let r = guess;
  for (let i = 0; i < maxIterations; i++) {
    // f(r) = P - PMT × (1 - (1+r)^-n) / r
    const power = Math.pow(1 + r, -n);
    const annuityFactor = (1 - power) / r;
    const f = P - PMT * annuityFactor;

    // d/dr[(1 - (1+r)^-n)/r] = [n × (1+r)^(-n-1) × r - (1 - (1+r)^-n)] / r^2
    // f'(r) = -PMT × d/dr[annuityFactor]
    //       = -PMT × [n × (1+r)^(-n-1) / r - (1 - (1+r)^-n) / r^2]
    const power_n_plus_1 = Math.pow(1 + r, -n - 1);
    const dfdr = -PMT * ((n * power_n_plus_1) / r - (1 - power) / (r * r));

    if (Math.abs(dfdr) < 1e-15) break; // numerical instability

    let rNew = r - f / dfdr;
    if (rNew <= 0) {
      // Bisect toward 0 to keep positive
      rNew = r / 2;
    } else if (rNew > 10) {
      // Cap explosive jumps — monthly rate above 1000% is non-physical
      rNew = Math.min(r * 2, 1);
    }
    if (Math.abs(rNew - r) < tolerance) {
      return new Decimal(rNew.toFixed(15));
    }
    r = rNew;
  }
  throw new Error(
    `EIR did not converge after ${maxIterations} iterations · ` +
      `principal=${principal}, monthlyPayment=${monthlyPayment}, n=${n}, lastR=${r}`,
  );
}

/**
 * Build full amortization schedule using EIR.
 *
 * Each period: interest = openingPrincipal × r (rounded HALF_UP to 2 decimals)
 *              principalPayment = monthlyPayment - interest
 *              closingPrincipal = openingPrincipal - principalPayment
 *
 * Final period: principalPayment = remaining openingPrincipal (snap to clear residual)
 */
export function buildEIRSchedule(
  principal: Decimal,
  monthlyPayment: Decimal,
  n: number,
  options: EIRSolverOptions = {},
): EIRPeriod[] {
  const r = solveMonthlyEIR(principal, monthlyPayment, n, options);
  const schedule: EIRPeriod[] = [];
  let openingPrincipal = principal;

  for (let i = 1; i <= n; i++) {
    let interest: Decimal;
    let principalPayment: Decimal;
    let closingPrincipal: Decimal;

    if (i === n) {
      // Final period: snap to clear residual
      principalPayment = openingPrincipal;
      interest = monthlyPayment.sub(principalPayment);
      closingPrincipal = new Decimal(0);
    } else {
      interest = openingPrincipal.mul(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      principalPayment = monthlyPayment.sub(interest);
      closingPrincipal = openingPrincipal.sub(principalPayment);
    }

    schedule.push({ period: i, openingPrincipal, interest, principalPayment, closingPrincipal });
    openingPrincipal = closingPrincipal;
  }

  return schedule;
}

/**
 * Allocate total interest across periods using EIR + adjust final period
 * so sum equals totalInterest exactly.
 *
 * Use this when caller has totalInterest as input (vs deriving from EIR).
 * Final period takes whatever residual remains.
 *
 * Edge cases:
 *   - totalInterest <= 0 (cash sale, 0% promo): returns array of n zeros.
 *     Solver is not called (would throw on equal totalPayments == principal).
 *   - n must be >= 1
 */
export function allocateInterestEIR(
  principal: Decimal,
  totalInterest: Decimal,
  n: number,
  options: EIRSolverOptions = {},
): Decimal[] {
  if (n <= 0) throw new Error('n must be positive');

  // Zero-interest contracts (cash installment, 0% promo): allocate zeros.
  // Avoids solver throwing on totalPayments == principal.
  if (totalInterest.lte(0)) {
    return Array.from({ length: n }, () => new Decimal(0));
  }

  // monthlyPayment uses ROUND_DOWN to 2dp — matches the CPA-certified flat-rate
  // amortization tables and per-installment values declared in CSV goldens.
  // (e.g. 17000/12 → PMT 1416.66, NOT 1416.6666... — required so per-period
  // interest amounts in the EIR schedule equal the hand-computed CPA values.)
  const totalReceipts = principal.add(totalInterest);
  const monthlyPayment = totalReceipts.div(n).toDecimalPlaces(2, Decimal.ROUND_DOWN);

  const schedule = buildEIRSchedule(principal, monthlyPayment, n, options);
  const interests = schedule.map((s) => s.interest);

  // Adjust final period to make sum exactly = totalInterest
  const sumExceptLast = interests
    .slice(0, n - 1)
    .reduce((a, b) => a.add(b), new Decimal(0));
  interests[n - 1] = totalInterest.sub(sumExceptLast);

  return interests;
}
