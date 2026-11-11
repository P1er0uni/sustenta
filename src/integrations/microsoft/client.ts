import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";

/**
 * Integración con Microsoft Graph (Outlook/Teams) para leer reuniones.
 * Cliente público SPA: flujo de código de autorización con PKCE, sin client secret.
 * Mientras no haya VITE_MS_CLIENT_ID la integración queda inactiva y la app
 * funciona con el modo demo o sin reuniones, sin romper nada.
 */
export const MS_CLIENT_ID = (import.meta.env["VITE_MS_CLIENT_ID"] as string | undefined) ?? "";
export const MS_TENANT_ID =
  (import.meta.env["VITE_MS_TENANT_ID"] as string | undefined) ?? "common";

export const msConfigurado = MS_CLIENT_ID.length > 0;

/** Solo lectura del propio calendario del usuario que conecta. */
const ALCANCES_GRAPH = ["Calendars.Read"];

let instancia: PublicClientApplication | null = null;
let inicializacion: Promise<PublicClientApplication> | null = null;

async function instanciaMsal(): Promise<PublicClientApplication> {
  if (!msConfigurado) {
    throw new Error(
      "La integración con Microsoft no está configurada. Define VITE_MS_CLIENT_ID y VITE_MS_TENANT_ID.",
    );
  }
  if (!inicializacion) {
    const creado = new PublicClientApplication({
      auth: {
        clientId: MS_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${MS_TENANT_ID}`,
        redirectUri:  window.location.origin + "/redirect.html",
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    instancia = creado;
    inicializacion = creado.initialize().then(() => creado);
  }
  return inicializacion;
}

/** Cuenta activa en la caché de MSAL, si la hay. */
export async function cuentaMicrosoftActiva(): Promise<AccountInfo | null> {
  if (!msConfigurado) return null;
  try {
    const msal = await instanciaMsal();
    return msal.getAllAccounts()[0] ?? null;
  } catch {
    return null;
  }
}

/** Abre el flujo de consentimiento (Calendars.Read) y devuelve la cuenta conectada. */
export async function conectarMicrosoft(): Promise<AccountInfo> {
  const msal = await instanciaMsal();
  const resultado = await msal.loginPopup({ scopes: ALCANCES_GRAPH });
  if (!resultado.account) throw new Error("Microsoft no devolvió una cuenta.");
  return resultado.account;
}

/** Cierra la sesión de Microsoft; ante cualquier fricción limpia la caché local. */
export async function desconectarMicrosoft(): Promise<void> {
  if (!msConfigurado) return;
  try {
    const msal = await instanciaMsal();
    const cuenta = msal.getAllAccounts()[0];
    if (cuenta) {
      await msal.logoutPopup({ account: cuenta });
    } else {
      msal.clearCache();
    }
  } catch {
    instancia?.clearCache();
  }
}

/** Token de acceso a Graph, renovado en silencio; popup de respaldo si expiró. */
export async function obtenerTokenGraph(): Promise<string> {
  const msal = await instanciaMsal();
  const cuenta = msal.getAllAccounts()[0];
  if (!cuenta) throw new Error("No hay una cuenta de Microsoft conectada.");
  try {
    const { accessToken } = await msal.acquireTokenSilent({
      scopes: ALCANCES_GRAPH,
      account: cuenta,
    });
    return accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      const { accessToken } = await msal.acquireTokenPopup({ scopes: ALCANCES_GRAPH });
      return accessToken;
    }
    throw error;
  }
}

/** Nombre legible de la cuenta (correo) para mostrar en la interfaz. */
export function etiquetaCuenta(cuenta: AccountInfo | null): string | null {
  return cuenta?.username ?? cuenta?.name ?? null;
}
