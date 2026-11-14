// How a sale went out. Only a tag for filtering and reporting; payments are recorded as usual.
export const SALE_CHANNELS = ["IN_STORE", "FINTREX", "COD"] as const;
export type SaleChannel = (typeof SALE_CHANNELS)[number];

export const CHANNEL_LABEL: Record<SaleChannel, string> = { IN_STORE: "In store", FINTREX: "Fintrex", COD: "COD" };

export const isSaleChannel = (v: unknown): v is SaleChannel => SALE_CHANNELS.includes(v as SaleChannel);
export const channelLabel = (v: string) => (isSaleChannel(v) ? CHANNEL_LABEL[v] : v);
