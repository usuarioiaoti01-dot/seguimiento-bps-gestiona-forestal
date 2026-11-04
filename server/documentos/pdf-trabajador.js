'use strict';
/**
 * Proceso aparte que extrae el texto de un PDF: recibe el archivo por la entrada estándar y devuelve
 * {"texto": ...} o {"error": ...}. Se ejecuta fuera del servidor porque (1) la librería de PDF y la de Excel
 * se estorban si conviven en un mismo proceso y (2) un PDF defectuoso o malicioso no debe poder colgar ni
 * tumbar la aplicación (el servidor lo corta a los 30 s y limita su memoria).
 */
// La librería de PDF escribe avisos de fuentes por la salida estándar; no deben mezclarse con la respuesta.
console.log = () => {}; console.info = () => {}; console.warn = () => {};
const salir = (json) => process.stdout.write(String.fromCharCode(10) + json); // en una línea propia, aunque la librería haya escrito algo antes
const trozos = [];
process.stdin.on('data', (t) => trozos.push(t));
process.stdin.on('end', () => {
  require('pdf-parse/lib/pdf-parse.js')(Buffer.concat(trozos))
    .then((r) => salir(JSON.stringify({ texto: r.text })))
    .catch((e) => salir(JSON.stringify({ error: String((e && e.message) || e) })));
});
