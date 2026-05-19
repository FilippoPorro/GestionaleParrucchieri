export interface Servizio {
    idServizio: number;
    nome: string;
    descrizione: string;
    durata: string | null;
    prezzo: number;
    categoria: string;
    sottocategoria: string;
    tipoPrenotazione: 'sito' | 'telefono' | 'consulenza';
    visualizzazioneSito?: boolean;
}
