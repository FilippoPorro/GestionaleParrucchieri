import express from "express";
import cors from "cors";
import cloudinary from "cloudinary";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import passport from "./config/passport";
import dotenv from "dotenv";
import { connectDatabase, db } from "./db_parrucchieri";
import aiRoute from "./routes/api-ai";
import loginRoute from "./routes/login";
import googleAuthRoute from "./routes/google-auth";
import utentiRoute from "./routes/utenti";
import appuntamentiRoute from "./routes/appuntamenti";
import serviziRoute from "./routes/servizi";
import dashboardRoute from "./routes/dashboard";
import cassaRoute from "./routes/cassa";
import fornitoriRoute from "./routes/fornitori";
import { startAppointmentReminderJob } from "./services/appointment-reminders";
import nodemailer from "nodemailer";


dotenv.config();
connectDatabase().then(() => {
  console.log("Database connesso nel server");
  startAppointmentReminderJob();
}).catch(err => {
  console.error("Errore connessione database:", err);
  process.exit(1);
});
const app = express();
const PORT = Number(process.env.PORT) || 3000;

const allowedFrontendOrigins = (
  process.env.FRONTEND_URLS ||
  process.env.FRONTEND_URL ||
  "http://localhost:4200"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function isAllowedFrontendOrigin(origin: string): boolean {
  const normalizedOrigin = origin.replace(/\/+$/, "");

  return allowedFrontendOrigins.includes(normalizedOrigin) ||
    normalizedOrigin === "http://localhost:4200" ||
    /^https:\/\/gestionale-parrucchieri-[a-z0-9-]+\.vercel\.app$/i.test(normalizedOrigin);
}

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME as string,
  api_key: process.env.CLOUDINARY_API_KEY as string,
  api_secret: process.env.CLOUDINARY_API_SECRET as string,
});
app.use("/", (req, res, next) => {
  console.log(`----> ${req.method}: ${req.originalUrl}`);
  next();
});

app.use("/", express.static("./static"));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "gestionale-parrucchieri-api",
    timestamp: new Date().toISOString()
  });
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || isAllowedFrontendOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS origin non consentita: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(passport.initialize());

function getOptionalUserIdFromRequest(req: express.Request): number | null {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.split(" ")[1];

  if (!token || !process.env.JWT_SECRET) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as {
      userId?: number;
    };

    return decoded.userId ?? null;
  } catch {
    return null;
  }
}

function isVisibleOnSite(record: any): boolean {
  const value =
    record?.["visualizzazione sito"] ??
    record?.visualizzazioneSito ??
    record?.visualizzazione_sito ??
    record?.visualizzazione;

  return value === true || value === 1 || value === "true" || value === "t";
}

function createSmtpTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    throw new Error("Configurazione SMTP incompleta");
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR"
  }).format(value);
}

function buildOrderConfirmationEmail(params: {
  name: string;
  surname: string;
  email: string;
  phone: string;
  shippingMethod: string;
  shippingCost: number;
  address?: string;
  city?: string;
  zip?: string;
  lockerLabel?: string;
  cartItems: any[];
  total: number;
  orderId: number;
}) {
  const shippingLabel =
    params.shippingMethod === "pickup"
      ? "Ritiro in negozio"
      : params.shippingMethod === "express"
      ? "Spedizione express"
      : params.shippingMethod === "standard"
        ? "Spedizione standard"
        : "Ritiro locker";

  const rows = params.cartItems
    .map((item) => {
      const qty = Number(item.quantita || 1);
      const unitPrice = Number(item.prezzo ?? item.prezzoRivendita ?? 0);
      const lineTotal = unitPrice * qty;

      return `
        <tr>
          <td style="padding:12px 10px;border-bottom:1px solid #ead7b6;color:#1a1a1a !important;">${item.nome}</td>
          <td style="padding:12px 10px;border-bottom:1px solid #ead7b6;color:#1a1a1a !important;text-align:center;">${qty}</td>
          <td style="padding:12px 10px;border-bottom:1px solid #ead7b6;color:#1a1a1a !important;text-align:right;">${formatCurrency(unitPrice)}</td>
          <td style="padding:12px 10px;border-bottom:1px solid #ead7b6;color:#1a1a1a !important;text-align:right;">${formatCurrency(lineTotal)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <title>Conferma acquisto</title>
        <style>
          :root {
            color-scheme: light only;
            supported-color-schemes: light only;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #f6f0e6 !important;
            background-color: #f6f0e6 !important;
            color: #16120d !important;
          }
          body, table, td, div, p, a, h1, th {
            font-family: Arial, sans-serif !important;
          }
          .mail-shell {
            background: #f6f0e6 !important;
            background-color: #f6f0e6 !important;
            color: #16120d !important;
          }
          .mail-card {
            background: #ffffff !important;
            background-color: #ffffff !important;
            color: #1a1a1a !important;
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#f6f0e6 !important;background-color:#f6f0e6 !important;color:#16120d !important;">
        <div class="mail-shell" style="margin:0;padding:32px 18px;background:#f6f0e6 !important;background-color:#f6f0e6 !important;color:#16120d !important;">
          <div style="max-width:760px;margin:0 auto;text-align:center;">
            <div style="margin:0 auto 14px;width:234px;background:#1b1610 !important;background-color:#1b1610 !important;border-radius:16px;padding:18px 22px;box-sizing:border-box;">
              <img
                src="https://res.cloudinary.com/duimlq34k/image/upload/v1776668316/logo-parrucchieri-oro-bianco_jkgk5v.png"
                alt="I Parrucchieri"
                style="display:block;width:100%;height:auto;border:0;"
              />
            </div>

            <div class="mail-card" style="margin:0 auto;max-width:718px;background:#ffffff !important;background-color:#ffffff !important;border:1px solid #e2c89b;border-radius:20px;padding:24px 34px 22px;text-align:left;box-sizing:border-box;color:#1a1a1a !important;">
              <div style="display:inline-block;margin-bottom:8px;padding:6px 12px;border:1px solid #e5c37d;border-radius:999px;background:#f8f2e8 !important;background-color:#f8f2e8 !important;color:#b67a08 !important;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                Conferma Acquisto
              </div>

              <h1 style="margin:0 0 10px;font-size:30px;line-height:1.2;color:#101010 !important;font-weight:800;">
                Il tuo ordine è stato registrato
              </h1>

              <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1a1a1a !important;">
                Ciao ${params.name} ${params.surname},
              </p>

              <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#1a1a1a !important;">
                abbiamo ricevuto con successo il tuo acquisto. Qui sotto trovi il riepilogo dell'ordine <strong>#${params.orderId}</strong>.
              </p>

              <div style="margin:0 0 18px;padding:18px;border:1px solid #efc983;border-radius:16px;background:#fbf3e3 !important;background-color:#fbf3e3 !important;">
                <div style="margin:0 0 8px;font-size:14px;color:#c08612 !important;font-weight:700;">Dettagli cliente</div>
                <div style="font-size:15px;line-height:1.8;color:#1a1a1a !important;">
                  <div><strong>Email:</strong> ${params.email}</div>
                  <div><strong>Telefono:</strong> ${params.phone || "-"}</div>
                  <div><strong>Consegna:</strong> ${shippingLabel}</div>
                  ${(params.shippingMethod === "standard" || params.shippingMethod === "express") && [params.address, params.zip, params.city].filter(Boolean).length > 0
                    ? `<div><strong>Indirizzo:</strong> ${[params.address, params.zip, params.city].filter(Boolean).join(", ")}</div>`
                    : ""}
                  ${params.shippingMethod === "locker" && params.lockerLabel
                    ? `<div><strong>Indirizzo:</strong> ${params.lockerLabel}</div>`
                    : ""}
                </div>
              </div>

              <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#fffdf8 !important;background-color:#fffdf8 !important;border:1px solid #ead7b6;border-radius:14px;overflow:hidden;">
                <thead>
                  <tr style="background:#f8f2e8 !important;background-color:#f8f2e8 !important;">
                    <th style="padding:12px 10px;text-align:left;color:#6f4d11 !important;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Prodotto</th>
                    <th style="padding:12px 10px;text-align:center;color:#6f4d11 !important;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Qta</th>
                    <th style="padding:12px 10px;text-align:right;color:#6f4d11 !important;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Prezzo</th>
                    <th style="padding:12px 10px;text-align:right;color:#6f4d11 !important;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>

              <div style="margin:0 0 18px;padding:16px;border:1px solid #ead7b6;border-radius:14px;background:#faf7f2 !important;background-color:#faf7f2 !important;">
                <div style="display:flex;justify-content:space-between;gap:12px;font-size:14px;line-height:1.8;color:#1a1a1a !important;">
                  <span>Spedizione:</span>
                  <strong>${formatCurrency(Number(params.shippingCost || 0))}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;gap:12px;font-size:17px;line-height:1.8;color:#101010 !important;font-weight:800;">
                  <span>Totale ordine:</span>
                  <span>${formatCurrency(params.total)}</span>
                </div>
              </div>

              <div style="display:block;width:100%;margin:0;padding:0;overflow:visible !important;white-space:normal !important;text-overflow:clip !important;">
              <p style="margin:0;display:block;width:100%;font-size:14px;line-height:1.7;color:#3a3126 !important;white-space:normal !important;overflow:visible !important;text-overflow:clip !important;word-break:break-word;">
                Grazie per aver acquistato da I Parrucchieri. Per qualsiasi dubbio puoi contattarci direttamente.
              </p>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

async function sendOrderConfirmationEmail(params: {
  name: string;
  surname: string;
  email: string;
  phone: string;
  shippingMethod: string;
  shippingCost: number;
  address?: string;
  city?: string;
  zip?: string;
  lockerLabel?: string;
  cartItems: any[];
  total: number;
  orderId: number;
}) {
  const smtpFrom = process.env.SMTP_FROM;

  if (!smtpFrom) {
    throw new Error("SMTP_FROM non configurato");
  }

  const transporter = createSmtpTransporter();

  await transporter.sendMail({
    from: `"I Parrucchieri" <${smtpFrom}>`,
    to: params.email,
    subject: "Conferma acquisto prodotti",
    html: buildOrderConfirmationEmail(params)
  });
}

type NormalizedCartItem = {
  productId: number;
  qty: number;
  prezzoUnitario: number;
};

type CheckoutRpcResult = {
  idVendita: number;
};

type CartReservationRow = {
  "idProdotto": number;
  "quantita": number;
  "prezzoUnitario": number;
  prodotti?: any;
};

const CART_TTL_MINUTES = 10;
const GUEST_CHECKOUT_USER_ID = -1;

function formatRomeTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function getCartIdFromRequest(req: express.Request): string | null {
  const headerCartId = req.header("x-cart-id");
  const bodyCartId = typeof req.body?.cartId === "string" ? req.body.cartId : "";
  const cartId = (headerCartId || bodyCartId || "").trim();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cartId)
    ? cartId
    : null;
}

function mapReservedCartItem(row: CartReservationRow) {
  const product = Array.isArray(row.prodotti) ? row.prodotti[0] || {} : row.prodotti || {};

  return {
    idProdotto: Number(row.idProdotto),
    foto: product.foto ?? null,
    nome: product.nome ?? "",
    marca: product.marca ?? "",
    formato: product.formato ?? "",
    descrizione: product.descrizione ?? "",
    prezzoRivendita: Number(product.prezzoRivendita ?? row.prezzoUnitario ?? 0),
    prezzoAcquisto: Number(product.prezzoAcquisto ?? 0),
    quantitaMagazzino: Number(product.quantitaMagazzino ?? 0),
    categoria: product.categoria ?? "",
    quantita: Number(row.quantita || 0)
  };
}

async function getReservedCart(cartId: string) {
  await db.rpc("expire_cart_reservations");

  const { data: cart, error: cartError } = await db
    .from("cart_sessions")
    .select("idCart, idUtente, expiresAt, status")
    .eq("idCart", cartId)
    .maybeSingle();

  if (cartError) throw cartError;

  if (!cart || cart.status !== "active" || new Date(cart.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const { data: items, error: itemsError } = await db
    .from("cart_items")
    .select(`
      idProdotto,
      quantita,
      prezzoUnitario,
      prodotti (
        idProdotto,
        foto,
        nome,
        marca,
        formato,
        descrizione,
        prezzoRivendita,
        prezzoAcquisto,
        quantitaMagazzino,
        categoria
      )
    `)
    .eq("idCart", cartId)
    .order("idProdotto", { ascending: true });

  if (itemsError) throw itemsError;

  if ((items || []).length === 0) {
    await db
      .from("cart_sessions")
      .delete()
      .eq("idCart", cartId);

    return null;
  }

  return {
    cartId: String(cart.idCart),
    expiresAt: String(cart.expiresAt),
    items: (items || []).map((item: any) => mapReservedCartItem(item))
  };
}

function normalizeCartItems(cartItems: any[]): NormalizedCartItem[] {
  const byProduct = new Map<number, NormalizedCartItem>();

  for (const item of cartItems) {
    const productId = Number(item.idProdotto ?? item.id);
    const qty = Number(item.quantita || 1);
    const prezzoUnitario = Number(item.prezzo ?? item.prezzoRivendita ?? 0);

    if (!Number.isFinite(productId) || !Number.isFinite(qty) || qty <= 0) {
      throw new Error("Prodotto o quantita non validi");
    }

    const existing = byProduct.get(productId);

    if (existing) {
      existing.qty += qty;
      continue;
    }

    byProduct.set(productId, {
      productId,
      qty,
      prezzoUnitario: Number.isFinite(prezzoUnitario) ? prezzoUnitario : 0
    });
  }

  return [...byProduct.values()];
}

function isStockError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as any)?.message === "string"
        ? (error as any).message
        : "";

  return /stock[_ ]insufficiente|cart_expired|cart_owner_mismatch/i.test(message);
}

function isMissingCheckoutRpcError(error: unknown): boolean {
  const code = typeof (error as any)?.code === "string" ? (error as any).code : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as any)?.message === "string"
        ? (error as any).message
        : "";

  return code === "PGRST202" && /complete_(reserved_cart_)?checkout_sicuro/i.test(message);
}

function isMissingCartSchemaError(error: unknown): boolean {
  const code = typeof (error as any)?.code === "string" ? (error as any).code : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as any)?.message === "string"
        ? (error as any).message
        : "";

  return code === "PGRST202" || code === "42P01" || /cart_sessions|cart_items|expire_cart_reservations/i.test(message);
}

async function completeCheckoutWithFallback(
  userId: number | null,
  total: number,
  normalizedItems: NormalizedCartItem[]
): Promise<CheckoutRpcResult> {
  const productIds = normalizedItems.map((item) => item.productId);

  const { data: stockRows, error: stockReadError } = await db
    .from("prodotti")
    .select("idProdotto, quantitaMagazzino")
    .in("idProdotto", productIds);

  if (stockReadError) throw stockReadError;

  const stockByProductId = new Map<number, number>();

  (stockRows || []).forEach((row: any) => {
    stockByProductId.set(Number(row.idProdotto), Number(row.quantitaMagazzino || 0));
  });

  for (const item of normalizedItems) {
    const availableStock = stockByProductId.get(item.productId);

    if (availableStock === undefined) {
      throw new Error("product_not_found");
    }

    if (availableStock < item.qty) {
      throw new Error("stock_insufficiente");
    }
  }

  const { data: venditaData, error: venditaError } = await db
    .from("vendite")
    .insert({
      idCliente: userId,
      data: new Date().toISOString(),
      totale: total
    })
    .select("idVendita")
    .single();

  if (venditaError) throw venditaError;

  const idVendita = Number((venditaData as any).idVendita);

  for (const item of normalizedItems) {
    const currentStock = stockByProductId.get(item.productId) ?? 0;

    const { data: updatedProduct, error: updateError } = await db
      .from("prodotti")
      .update({
        quantitaMagazzino: currentStock - item.qty
      })
      .eq("idProdotto", item.productId)
      .gte("quantitaMagazzino", item.qty)
      .select("idProdotto")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updatedProduct) {
      throw new Error("stock_insufficiente");
    }
  }

  const details = normalizedItems.map((item) => ({
    idVendita,
    idProdotto: item.productId,
    quantita: item.qty,
    prezzoUnitario: item.prezzoUnitario
  }));

  const { error: detailsError } = await db
    .from("dettagliovendita")
    .insert(details);

  if (detailsError) throw detailsError;

  return { idVendita };
}
app.get("/api/imgParrucchieri", async (req, res) => {
  try {
    const result = await cloudinary.v2.search
      .expression("folder:ImgParrucchieri")
      .sort_by("created_at", "desc")
      .max_results(100)
      .execute();

    const images = result.resources.map((img: any) => img.secure_url);
    res.json(images);
  } catch {
    res.status(500).send("Errore Cloudinary");
  }
});
app.get("/api/imgProdotti", async (req, res) => {
  try {
    const result = await cloudinary.v2.search
      .expression("folder:ImgParrucchieri/prodotti")
      .sort_by("created_at", "desc")
      .max_results(100)
      .execute();

    const images = result.resources.map((img: any) => img.secure_url);
    console.log(images);
    res.json(images);
  } catch {
    res.status(500).send("Errore Cloudinary");
  }
});
app.use("/api/chat", aiRoute);
app.use("/api/auth", loginRoute);
app.use("/api/auth", googleAuthRoute);
app.use("/api/utenti", utentiRoute);
app.use("/api/appuntamenti", appuntamentiRoute);
app.use("/api/servizi", serviziRoute);
app.use("/api/dashboard", dashboardRoute);
app.use("/api/cassa", cassaRoute);
app.use("/api/fornitori", fornitoriRoute);
app.get("/api/prodotti", async (req, res) => {
  try {
    const cartId = getCartIdFromRequest(req);
    const { error: expireError } = await db.rpc("expire_cart_reservations");

    if (expireError && !isMissingCartSchemaError(expireError)) {
      throw expireError;
    }

    const { data, error } = await db
      .from("prodotti")
      .select(
        'idProdotto, foto, nome, marca, formato, descrizione, prezzoRivendita, prezzoAcquisto, quantitaMagazzino, categoria'
      )
      .order("categoria", { ascending: true })
      .order("marca", { ascending: true })
      .order("nome", { ascending: true })
      .order("idProdotto", { ascending: true });
    if (error) throw error;

    const { data: reservedRows, error: reservedError } = await db
      .from("cart_items")
      .select("idCart, idProdotto, quantita, cart_sessions!inner(status, expiresAt)")
      .eq("cart_sessions.status", "active")
      .gt("cart_sessions.expiresAt", formatRomeTimestamp());

    if (reservedError) {
      if (isMissingCartSchemaError(reservedError)) {
        return res.json(data || []);
      }

      throw reservedError;
    }

    const reservedByProduct = new Map<number, number>();

    (reservedRows || []).forEach((row: any) => {
      if (cartId && row.idCart === cartId) {
        return;
      }

      const productId = Number(row.idProdotto);
      reservedByProduct.set(productId, (reservedByProduct.get(productId) || 0) + Number(row.quantita || 0));
    });

    res.json((data || []).map((product: any) => ({
      ...product,
      quantitaMagazzino: Math.max(
        0,
        Number(product.quantitaMagazzino || 0) - (reservedByProduct.get(Number(product.idProdotto)) || 0)
      )
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Errore server" });
  }
});

app.get("/api/cart", async (req, res) => {
  let cartId = getCartIdFromRequest(req);
  const userId = getOptionalUserIdFromRequest(req);

  try {
    if (!cartId && userId !== null) {
      const { data: userCart, error: userCartError } = await db
        .from("cart_sessions")
        .select("idCart")
        .eq("idUtente", userId)
        .eq("status", "active")
        .gt("expiresAt", formatRomeTimestamp())
        .order("updatedAt", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (userCartError) throw userCartError;

      cartId = userCart?.idCart ? String(userCart.idCart) : null;
    }

    if (!cartId) {
      return res.json({ cartId: null, expiresAt: null, items: [] });
    }

    const cart = await getReservedCart(cartId);
    return res.json(cart || { cartId: null, expiresAt: null, items: [] });
  } catch (err: any) {
    console.error("Errore GET /api/cart:", err);
    return res.status(500).json({ message: "Errore caricamento carrello", error: err.message });
  }
});

app.get("/api/cart/active", async (req, res) => {
  const userId = getOptionalUserIdFromRequest(req);

  if (userId === null) {
    return res.json({ cartId: null, expiresAt: null, items: [] });
  }

  try {
    const { data: userCart, error: userCartError } = await db
      .from("cart_sessions")
      .select("idCart")
      .eq("idUtente", userId)
      .eq("status", "active")
      .gt("expiresAt", formatRomeTimestamp())
      .order("updatedAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (userCartError) throw userCartError;

    const cartId = userCart?.idCart ? String(userCart.idCart) : null;

    if (!cartId) {
      return res.json({ cartId: null, expiresAt: null, items: [] });
    }

    const cart = await getReservedCart(cartId);
    return res.json(cart || { cartId: null, expiresAt: null, items: [] });
  } catch (err: any) {
    console.error("Errore GET /api/cart/active:", err);
    return res.status(500).json({ message: "Errore caricamento carrello", error: err.message });
  }
});

app.post("/api/cart/claim", async (req, res) => {
  const cartId = getCartIdFromRequest(req);
  const userId = getOptionalUserIdFromRequest(req);

  if (!cartId || userId === null) {
    return res.json({ cartId: null, expiresAt: null, items: [] });
  }

  try {
    await db.rpc("expire_cart_reservations");

    const { error: claimError } = await db
      .from("cart_sessions")
      .update({
        idUtente: userId,
        updatedAt: formatRomeTimestamp()
      })
      .eq("idCart", cartId)
      .eq("status", "active")
      .gt("expiresAt", formatRomeTimestamp());

    if (claimError) throw claimError;

    const cart = await getReservedCart(cartId);
    return res.json(cart || { cartId: null, expiresAt: null, items: [] });
  } catch (err: any) {
    console.error("Errore POST /api/cart/claim:", err);
    return res.status(500).json({ message: "Errore associazione carrello", error: err.message });
  }
});

app.post("/api/cart/items", async (req, res) => {
  const cartId = getCartIdFromRequest(req);
  const productId = Number(req.body?.productId ?? req.body?.idProdotto);
  const quantity = Number(req.body?.quantity ?? req.body?.quantita ?? 1);
  const userId = getOptionalUserIdFromRequest(req);

  if (!Number.isFinite(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity < 0) {
    return res.status(400).json({ message: "Prodotto o quantita non validi" });
  }

  try {
    const { data, error } = await db
      .rpc("reserve_cart_item_sicuro", {
        p_cart_id: cartId,
        p_id_utente: userId,
        p_product_id: productId,
        p_qty: quantity,
        p_ttl_minutes: CART_TTL_MINUTES
      })
      .single();

    if (error) throw error;

    const reservedCartId = String((data as any)?.cartId || (data as any)?.idCart || cartId || "");
    const cart = reservedCartId ? await getReservedCart(reservedCartId) : null;

    return res.json(cart || {
      cartId: reservedCartId || null,
      expiresAt: (data as any)?.expiresAt || null,
      items: []
    });
  } catch (err: any) {
    console.error("Errore POST /api/cart/items:", err);
    return res.status(isStockError(err) ? 409 : 500).json({
      message: isStockError(err) ? "Stock insufficiente" : "Errore aggiornamento carrello",
      error: err.message
    });
  }
});

app.delete("/api/cart/items/:productId", async (req, res) => {
  const cartId = getCartIdFromRequest(req);
  const productId = Number(req.params.productId);

  if (!cartId || !Number.isFinite(productId) || productId <= 0) {
    return res.status(400).json({ message: "Carrello o prodotto non valido" });
  }

  try {
    const { data, error } = await db
      .rpc("reserve_cart_item_sicuro", {
        p_cart_id: cartId,
        p_id_utente: getOptionalUserIdFromRequest(req),
        p_product_id: productId,
        p_qty: 0,
        p_ttl_minutes: CART_TTL_MINUTES
      })
      .single();

    if (error) throw error;

    const reservedCartId = String((data as any)?.cartId || (data as any)?.idCart || cartId);
    const cart = await getReservedCart(reservedCartId);

    return res.json(cart || { cartId: reservedCartId, expiresAt: null, items: [] });
  } catch (err: any) {
    console.error("Errore DELETE /api/cart/items/:productId:", err);
    return res.status(500).json({ message: "Errore rimozione prodotto", error: err.message });
  }
});

app.delete("/api/cart", async (req, res) => {
  const cartId = getCartIdFromRequest(req);

  if (!cartId) {
    return res.json({ message: "Carrello svuotato" });
  }

  try {
    const { error: itemsDeleteError } = await db
      .from("cart_items")
      .delete()
      .eq("idCart", cartId);

    if (itemsDeleteError) throw itemsDeleteError;

    const { error } = await db
      .from("cart_sessions")
      .delete()
      .eq("idCart", cartId);

    if (error) throw error;

    return res.json({ message: "Carrello svuotato" });
  } catch (err: any) {
    console.error("Errore DELETE /api/cart:", err);
    return res.status(500).json({ message: "Errore svuotamento carrello", error: err.message });
  }
});
app.post("/api/prodotti", async (req, res) => {
  try {
    const { foto, nome, marca, formato, descrizione, prezzoRivendita, prezzoAcquisto, qta, categoria } = req.body;

    if (!nome || prezzoRivendita === undefined || prezzoAcquisto === undefined || qta === undefined) {
      return res.status(400).json({ message: "Nome, prezzi e quantita sono obbligatori" });
    }

    const { data, error } = await db
      .from("prodotti")
      .insert({
        foto: foto || null,
        nome,
        marca: marca || "",
        formato: formato || "",
        descrizione: descrizione || "",
        prezzoRivendita: Number(prezzoRivendita),
        prezzoAcquisto: Number(prezzoAcquisto),
        quantitaMagazzino: Number(qta),
        categoria: categoria || ""
      })
      .select('idProdotto, foto, nome, marca, formato, descrizione, prezzoRivendita, prezzoAcquisto, quantitaMagazzino, categoria')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    console.error("Errore POST /api/prodotti:", err);
    res.status(500).json({ message: err.message || "Errore server" });
  }
});
app.put("/api/prodotti/:id", async (req, res) => {
  try {
    const idProdotto = Number(req.params.id);
    if (!Number.isFinite(idProdotto) || idProdotto <= 0) {
      return res.status(400).json({ message: "idProdotto non valido" });
    }

    const { foto, nome, marca, formato, descrizione, prezzoRivendita, prezzoAcquisto, qta, categoria } = req.body;

    if (!nome || prezzoRivendita === undefined || prezzoAcquisto === undefined || qta === undefined) {
      return res.status(400).json({ message: "Nome, prezzi e quantita sono obbligatori" });
    }

    const { data, error } = await db
      .from("prodotti")
      .update({
        foto: foto || null,
        nome,
        marca: marca || "",
        formato: formato || "",
        descrizione: descrizione || "",
        prezzoRivendita: Number(prezzoRivendita),
        prezzoAcquisto: Number(prezzoAcquisto),
        quantitaMagazzino: Number(qta),
        categoria: categoria || ""
      })
      .eq("idProdotto", idProdotto)
      .select('idProdotto, foto, nome, marca, formato, descrizione, prezzoRivendita, prezzoAcquisto, quantitaMagazzino, categoria')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ message: "Prodotto non trovato" });
    }

    res.json(data);
  } catch (err: any) {
    console.error("Errore PUT /api/prodotti/:id:", err);
    res.status(500).json({ message: err.message || "Errore server" });
  }
});
app.delete("/api/prodotti/:id", async (req, res) => {
  try {
    const idProdotto = Number(req.params.id);
    if (!Number.isFinite(idProdotto) || idProdotto <= 0) {
      return res.status(400).json({ message: "idProdotto non valido" });
    }

    const { data, error } = await db
      .from("prodotti")
      .delete()
      .eq("idProdotto", idProdotto)
      .select("idProdotto")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ message: "Prodotto non trovato" });
    }

    res.json({ message: "Prodotto eliminato con successo" });
  } catch (err: any) {
    console.error("Errore DELETE /api/prodotti/:id:", err);
    res.status(500).json({ message: err.message || "Errore server" });
  }
});
app.post("/api/register", async (req, res) => {
  try {
    const { nome, cognome, email, password, telefono, data_nascita, ruolo } =
      req.body;

    const { data: existingUser, error: existingError } = await db
      .from("utenti")
      .select("idUtente")
      .eq("email", email)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingUser) {
      return res.status(400).json({ message: "Email già registrata" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { error: insertError } = await db.from("utenti").insert({
      nome,
      cognome,
      email,
      password: hashedPassword,
      telefono,
      data_nascita,
      ruolo,
    });

    if (insertError) throw insertError;

    res.status(201).json({ message: "Account creato!" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Errore server", error: err.message });
  }
});
app.post("/api/products/update-stock", async (req, res) => {
  const cartItems = req.body;

  try {
    const normalizedItems = normalizeCartItems(Array.isArray(cartItems) ? cartItems : []);

    const { error } = await db.rpc("decrement_product_stock_sicuro", {
      p_items: normalizedItems
    });

    if (error) throw error;

    res.json({ message: "Stock aggiornato" });
  } catch (err: any) {
    console.error(err);
    res.status(isStockError(err) ? 409 : 500).json({
      message: "Errore aggiornamento stock",
      error: err.message,
    });
  }
});

app.post("/api/checkout/complete", async (req, res) => {
  const cartItems = Array.isArray(req.body?.cartItems) ? req.body.cartItems : [];
  const total = Number(req.body?.total ?? 0);
  const customer = req.body?.customer ?? {};
  const authenticatedUserId = getOptionalUserIdFromRequest(req);
  const cartId = getCartIdFromRequest(req);
  const customerEmail = String(customer?.email ?? "").trim();
  const customerName = String(customer?.name ?? "").trim();
  const customerSurname = String(customer?.surname ?? "").trim();
  const customerPhone = String(customer?.phone ?? "").trim();
  const shippingMethod = String(customer?.shippingMethod ?? "standard").trim();
  const shippingCost = Number(customer?.shippingCost ?? 0);
  const address = String(customer?.address ?? "").trim();
  const city = String(customer?.city ?? "").trim();
  const zip = String(customer?.zip ?? "").trim();
  const lockerLabel = String(customer?.lockerLabel ?? "").trim();

  if (cartItems.length === 0) {
    return res.status(400).json({ message: "Carrello vuoto" });
  }

  if (!Number.isFinite(total) || total <= 0) {
    return res.status(400).json({ message: "Totale non valido" });
  }

  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return res.status(400).json({ message: "Email checkout non valida" });
  }

  try {
    const checkoutUserId = authenticatedUserId ?? GUEST_CHECKOUT_USER_ID;
    let vendita: CheckoutRpcResult | null = null;

    if (cartId) {
      const { data: cartCheckoutData, error: cartCheckoutError } = await db
        .rpc("complete_reserved_cart_checkout_sicuro", {
          p_cart_id: cartId,
          p_id_cliente: checkoutUserId,
          p_total: total
        })
        .single();

      if (!cartCheckoutError) {
        vendita = cartCheckoutData as CheckoutRpcResult | null;
      } else if (!isMissingCheckoutRpcError(cartCheckoutError)) {
        throw cartCheckoutError;
      }
    }

    if (!vendita?.idVendita) {
      const normalizedItems = normalizeCartItems(cartItems);

      const { data: checkoutData, error: checkoutError } = await db
        .rpc("complete_checkout_sicuro", {
          p_id_cliente: checkoutUserId,
          p_total: total,
          p_items: normalizedItems
        })
        .single();

      if (checkoutError && !isMissingCheckoutRpcError(checkoutError)) {
        throw checkoutError;
      }

      vendita = checkoutError
        ? await completeCheckoutWithFallback(checkoutUserId, total, normalizedItems)
        : checkoutData as CheckoutRpcResult | null;
    }

    if (!vendita?.idVendita) {
      throw new Error("checkout_result_invalid");
    }

    if (cartId) {
      const { error: cartCleanupError } = await db
        .from("cart_sessions")
        .delete()
        .eq("idCart", cartId);

      if (cartCleanupError) {
        console.error("Errore pulizia carrello dopo checkout:", cartCleanupError);
      }
    }

    try {
      await sendOrderConfirmationEmail({
        name: customerName || "Cliente",
        surname: customerSurname,
        email: customerEmail,
        phone: customerPhone,
        shippingMethod,
        shippingCost: Number.isFinite(shippingCost) ? shippingCost : 0,
        address,
        city,
        zip,
        lockerLabel,
        cartItems,
        total,
        orderId: vendita.idVendita,
      });
    } catch (mailError) {
      console.error("Errore invio mail conferma acquisto:", mailError);
    }

    return res.status(201).json({
      message: "Checkout completato",
      idVendita: vendita?.idVendita,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(isStockError(err) ? 409 : 500).json({
      message: "Errore durante il salvataggio della vendita",
      error: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server attivo su http://localhost:${PORT}`);
});
