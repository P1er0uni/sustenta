import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generarInforme } from "./informe.mjs";

const USO = `Uso: npm run informe -- <resultados/analisis-....json> [<caso.json> ...]

Regenera los PDF desde un análisis ya guardado, sin llamar a la IA (no gasta cuota).
Los análisis guardados antes de incluir el registro necesitan los caso.json para recuperarlo.`;

const [rutaResultado, ...rutasCasos] = process.argv.slice(2);
if (!rutaResultado) {
  console.log(USO);
  process.exit(1);
}

const resultados = JSON.parse(await readFile(resolve(rutaResultado), "utf8"));
const registros = new Map();
for (const r of rutasCasos) {
  const { registro } = JSON.parse(await readFile(resolve(r), "utf8"));
  registros.set(registro.id, registro);
}

const carpeta = fileURLToPath(new URL("../informes/", import.meta.url));
for (const { registro: propio, ...resultado } of resultados) {
  const registro = propio ?? registros.get(resultado.registroId);
  if (!registro) {
    console.log(`Sin datos del registro ${resultado.registroId}: pasa su caso.json como argumento.`);
    continue;
  }
  const out = await generarInforme({ registro, resultado, carpeta });
  if (out.pdf) {
    const info = out.paginas ? ` (${out.paginas} pág., fuente ${out.tamanoFuente}px)` : "";
    console.log(`Informe PDF: ${out.pdf}${info}`);
  } else {
    console.log(`Informe HTML (sin PDF): ${out.html}\n   ${out.motivo}`);
  }
}
