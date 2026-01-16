
export interface PriceEntry {
  product: string;
  price: number;
}

export interface Supplier {
  id: string;
  name: string;
  lastUpdate?: string;
}

export interface ComparisonData {
  [supplierId: string]: {
    [productName: string]: number;
  };
}

export interface ProductMapping {
  [key: string]: string;
}

export interface MasterProduct {
  name: string;
  is_favorite: boolean;
}
