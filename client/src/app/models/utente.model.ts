export interface Utente {
    idUtente: number;
    nome: string;
    cognome: string;
    email: string;
    telefono?: string | null;
    data_nascita?: string | null;
    sesso?: 'm' | 'f' | null;
    ruolo?: string;
    photoURL?: string | null;
    picture?: string | null;
    avatar_url?: string | null;
    avatar?: string | null;
    mustChangePassword?: boolean;
  }
