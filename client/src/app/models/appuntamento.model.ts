export interface Appuntamento {
    idAppuntamento: number;
    idCliente: number | null;
    idOperatore: number;
    dataOraInizio: string;
    dataOraFine: string;
    stato: string | null;
    note: string | null;
    idServizio?: number | null;
    servizioNome?: string | null;
  }
