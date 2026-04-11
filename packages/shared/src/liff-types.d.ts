export interface LiffPayment {
    installmentNo: number;
    dueDate: string;
    amountDue: number;
    amountPaid: number;
    lateFee: number;
    status: string;
    paidDate: string | null;
    paymentMethod: string | null;
}
export interface LiffContract {
    id: string;
    contractNumber: string;
    status: string;
    product: string;
    sellingPrice: number;
    downPayment: number;
    monthlyPayment: number;
    totalMonths: number;
    paidInstallments: number;
    totalOutstanding: number;
    createdAt: string;
    payments: LiffPayment[];
}
export interface LiffContractResponse {
    customer: {
        name: string;
    };
    contracts: LiffContract[];
}
export interface LiffHistoryPayment {
    contractNumber: string;
    installmentNo: number;
    amountPaid: number;
    paidDate: string | null;
    paymentMethod: string | null;
    lateFee: number;
}
export interface LiffHistoryResponse {
    customer: {
        name: string;
    };
    payments: LiffHistoryPayment[];
}
export interface LiffProfileResponse {
    name: string;
    phone: string;
    lineDisplayName: string;
    contractCount: number;
    totalPoints: number;
}
export interface LiffEarlyPayoffQuote {
    remainingMonths: number;
    remainingPrincipal: number;
    remainingInterest: number;
    discount: number;
    partiallyPaidCredit: number;
    unpaidLateFees: number;
    totalPayoff: number;
    contractNumber: string;
    customerName: string;
}
export interface LiffRegisterLookupResponse {
    customerId: string;
    maskedName: string;
}
export interface LiffPaymentLinkData {
    valid: boolean;
    token: string;
    amount: number;
    status: string;
    expiresAt: string;
    contract: {
        id: string;
        contractNumber: string;
        customer: {
            name: string;
        };
    };
    payment: {
        installmentNo: number;
        amountDue: number;
        lateFee: number;
        dueDate: string;
    } | null;
    promptPay?: {
        qrDataUrl: string | null;
        accountName: string;
        maskedId: string;
    };
}
export interface LiffPaymentLinkResult {
    url: string;
    token: string;
    totalPayoff?: number;
}
