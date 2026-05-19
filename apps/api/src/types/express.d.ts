declare global {
  namespace Express {
    interface Request {
      entityScope?: 'SHOP' | 'FINANCE';
    }
  }
}

export {};
