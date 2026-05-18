import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import dotenv from "dotenv";
import { db } from "../db_parrucchieri";

dotenv.config();

interface GoogleUser {
  id: number;
  nome: string;
  cognome: string;
  email: string;
  ruolo: string;
  photoURL?: string | null;
}

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl =
  process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/api/auth/google/callback";

if (!googleClientId || !googleClientSecret) {
  throw new Error("GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET mancanti nel file .env");
}

function extractGoogleNames(profile: Profile) {
  const rawNome =
    profile.name?.givenName ||
    (profile as any)._json?.given_name ||
    "";

  const rawCognome =
    profile.name?.familyName ||
    (profile as any)._json?.family_name ||
    "";

  const displayName = (profile.displayName || "").trim();
  const parts = displayName.split(" ").filter(Boolean);

  if (parts.length >= 2) {
    const firstPart = parts[0];
    const lastPart = parts[parts.length - 1];

    if (
      rawNome &&
      rawCognome &&
      rawNome.toLowerCase() === firstPart.toLowerCase() &&
      rawCognome.toLowerCase() === lastPart.toLowerCase()
    ) {
      return {
        nome: rawNome,
        cognome: rawCognome
      };
    }

    if (
      rawNome &&
      rawCognome &&
      rawNome.toLowerCase() === lastPart.toLowerCase() &&
      rawCognome.toLowerCase() === firstPart.toLowerCase()
    ) {
      return {
        nome: lastPart,
        cognome: firstPart
      };
    }

    return {
      nome: rawNome || firstPart,
      cognome: rawCognome || lastPart
    };
  }

  return {
    nome: rawNome,
    cognome: rawCognome
  };
}

function buildFallbackNames(profile: Profile) {
  const displayName = (profile.displayName || "").trim();
  const parts = displayName.split(" ").filter(Boolean);

  return {
    nome: parts[0] || "Utente",
    cognome: parts.slice(1).join(" ") || "Google"
  };
}

function isMissingPhotoColumnError(error: any): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const hint = String(error?.hint ?? "").toLowerCase();
  const combined = `${message} ${details} ${hint}`;

  return combined.includes("photourl") &&
    (combined.includes("column") || combined.includes("schema cache"));
}

async function persistGooglePhotoURL(idUtente: number, photoURL: string | null): Promise<void> {
  if (!photoURL) {
    return;
  }

  const { error } = await db
    .from("utenti")
    .update({ photoURL })
    .eq("idUtente", idUtente);

  if (error && !isMissingPhotoColumnError(error)) {
    console.warn("Impossibile salvare la foto profilo Google:", error);
  }
}

passport.use(
  new GoogleStrategy(
    {
      clientID: googleClientId,
      clientSecret: googleClientSecret,
      callbackURL: googleCallbackUrl
    },
    async (
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: (error: any, user?: any) => void
    ) => {
      try {
        const email = String(profile.emails?.[0]?.value || "").trim().toLowerCase();
        const googleId = profile.id || "";
        const fotoProfilo = profile.photos?.[0]?.value || "";

        const extractedNames = extractGoogleNames(profile);
        const fallbackNames = buildFallbackNames(profile);
        const nome = extractedNames.nome?.trim() || fallbackNames.nome;
        const cognome = extractedNames.cognome?.trim() || fallbackNames.cognome;

        console.log("GOOGLE RAW PROFILE:", {
          id: profile.id,
          displayName: profile.displayName,
          givenName: profile.name?.givenName,
          familyName: profile.name?.familyName,
          jsonGivenName: (profile as any)._json?.given_name,
          jsonFamilyName: (profile as any)._json?.family_name,
          email,
          googleId,
          photo: fotoProfilo
        });

        console.log("DATI FINALI USATI:", {
          nome,
          cognome,
          email
        });

        if (!email) {
          return done(new Error("Email Google non disponibile"));
        }

        const { data: user, error: selectError } = await db
          .from("utenti")
          .select("idUtente, nome, cognome, email, ruolo")
          .eq("email", email)
          .maybeSingle();

        if (selectError) {
          throw selectError;
        }

        if (!user) {
          const { data: createdUser, error: insertError } = await db
            .from("utenti")
            .insert({
              nome,
              cognome,
              email,
              password: "",
              telefono: null,
              data_nascita: null,
              ruolo: "cliente",
            })
            .select("idUtente, nome, cognome, email, ruolo")
            .single();

          if (insertError) {
            console.error("Errore inserimento utente Google:", insertError);
            throw insertError;
          }

          await persistGooglePhotoURL(createdUser.idUtente, fotoProfilo || null);

          const newUser: GoogleUser = {
            id: createdUser.idUtente,
            nome: createdUser.nome,
            cognome: createdUser.cognome,
            email: createdUser.email,
            ruolo: createdUser.ruolo,
            photoURL: fotoProfilo || null
          };

          return done(null, newUser);
        }

        const { error: updateError } = await db
          .from("utenti")
          .update({ nome, cognome })
          .eq("idUtente", user.idUtente);

        if (updateError) {
          throw updateError;
        }

        await persistGooglePhotoURL(user.idUtente, fotoProfilo || null);

        const existingUser: GoogleUser = {
          id: user.idUtente,
          nome,
          cognome,
          email: user.email,
          ruolo: user.ruolo,
          photoURL: fotoProfilo || null
        };

        return done(null, existingUser);
      } catch (error) {
        console.error("Errore autenticazione Google:", error);
        return done(error);
      }
    }
  )
);

passport.serializeUser((user: any, done) => {
  done(null, user);
});

passport.deserializeUser((user: any, done) => {
  done(null, user);
});

export default passport;
