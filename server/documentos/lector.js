'use strict';
/**
 * Lee un documento subido y devuelve su contenido sin interpretarlo:
 *   - tablas (Excel .xlsx, CSV, cronograma exportado de MS Project en XML): { tipo: 'tablas', hojas: [{ nombre, filas }] }
 *   - texto (PDF con texto, Word .docx): { tipo: 'texto', texto }
 * Solo se aceptan estas extensiones y se comprueba la firma del archivo; no se ejecutan macros ni se abren
 * formatos binarios propietarios (.mpp, .xls, .xlsm, .doc): se piden en uno de los formatos admitidos.
 */
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const { XMLParser } = require('fast-xml-parser');

const MAX_FILAS = 5000;
const FORMATOS = ['.xlsx', '.csv', '.xml', '.pdf', '.docx'];
const error = (mensaje) => Object.assign(new Error(mensaje), { estado: 400 });

const extension = (nombre) => { const m = /\.[a-z0-9]+$/i.exec(String(nombre || '')); return m ? m[0].toLowerCase() : ''; };
const empieza = (buf, ...bytes) => bytes.every((b, i) => buf[i] === b);

/** Separa un CSV (delimitador ; o , según el encabezado; admite comillas dobles). */
function leerCsv(buf) {
  let texto = buf.toString('utf8');
  if (texto.includes('�')) texto = buf.toString('latin1'); // archivos de Excel en Windows (ANSI)
  texto = texto.replace(/^﻿/, '');
  const primera = texto.split(/\r?\n/, 1)[0] || '';
  const delim = (primera.match(/;/g) || []).length >= (primera.match(/,/g) || []).length ? ';' : ',';
  const filas = []; let fila = []; let celda = ''; let comillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') { celda += '"'; i += 1; } else if (ch === '"') comillas = false; else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === delim) { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i += 1;
      fila.push(celda); celda = ''; filas.push(fila); fila = [];
      if (filas.length > MAX_FILAS) throw error(`El documento supera las ${MAX_FILAS} filas`);
    } else celda += ch;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return [{ nombre: 'CSV', filas: filas.filter((f) => f.some((c) => String(c).trim() !== '')) }];
}

/** Valor legible de una celda de Excel (fechas a AAAA-MM-DD, fórmulas a su resultado, % a 0–100). */
function valorCelda(celda) {
  let v = celda.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) v = v.result; // fórmula
    else if ('richText' in v) v = v.richText.map((t) => t.text).join('');
    else if ('text' in v) v = v.text; // hipervínculo
    else if ('error' in v) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number' && celda.numFmt && /%/.test(celda.numFmt)) return Math.round(v * 10000) / 100;
  return v ?? '';
}

async function leerXlsx(buf) {
  const libro = new ExcelJS.Workbook();
  try { await libro.xlsx.load(buf); } catch { throw error('No se pudo abrir el Excel: guárdelo como .xlsx (sin contraseña)'); }
  const hojas = [];
  libro.eachSheet((hoja) => {
    const filas = [];
    hoja.eachRow({ includeEmpty: false }, (fila) => {
      if (filas.length >= MAX_FILAS) throw error(`La hoja «${hoja.name}» supera las ${MAX_FILAS} filas`);
      const celdas = []; fila.eachCell({ includeEmpty: true }, (c, i) => { celdas[i - 1] = valorCelda(c); });
      filas.push(Array.from(celdas, (c) => c ?? ''));
    });
    hojas.push({ nombre: hoja.name, filas });
  });
  return hojas;
}

/** Cronograma de MS Project guardado como «XML» (MSPDI): una fila por tarea (sin resúmenes ni la tarea 0). */
function leerProjectXml(buf) {
  const doc = new XMLParser({ ignoreAttributes: true, parseTagValue: false, processEntities: false }).parse(buf.toString('utf8'));
  const proyecto = doc && doc.Project;
  if (!proyecto) throw error('El XML no es un cronograma de MS Project (se espera el formato XML de Project)');
  const tareas = [].concat((proyecto.Tasks && proyecto.Tasks.Task) || []);
  const filas = [['N.°', 'Nombre de tarea', 'Inicio', 'Fin', '% completado']];
  for (const t of tareas) {
    if (String(t.UID) === '0' || String(t.Summary) === '1' || !t.Name) continue;
    filas.push([t.WBS || t.OutlineNumber || '', t.Name, String(t.Start || '').slice(0, 10), String(t.Finish || '').slice(0, 10), t.PercentComplete ?? '']);
    if (filas.length > MAX_FILAS) throw error(`El cronograma supera las ${MAX_FILAS} tareas`);
  }
  if (filas.length === 1) throw error('El cronograma de MS Project no tiene tareas');
  return [{ nombre: 'Cronograma', filas }];
}

/** Extrae el texto de un PDF en un proceso aparte (ver pdf-trabajador.js), con límite de tiempo y de memoria. */
function textoDePdf(buf) {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(process.execPath, ['--max-old-space-size=256', path.join(__dirname, 'pdf-trabajador.js')], { stdio: ['pipe', 'pipe', 'ignore'] });
    const salida = []; let vencido = false;
    const reloj = setTimeout(() => { vencido = true; hijo.kill('SIGKILL'); }, 30000);
    hijo.stdout.on('data', (t) => salida.push(t));
    hijo.on('error', (e) => { clearTimeout(reloj); console.error('[documentos] PDF no se pudo iniciar:', e.message); rechazar(error('No se pudo leer el PDF')); });
    hijo.on('close', () => {
      clearTimeout(reloj);
      if (vencido) return rechazar(error('El PDF tardó demasiado en leerse'));
      try {
        const lineas = Buffer.concat(salida).toString('utf8').trim().split(String.fromCharCode(10));
        const r = JSON.parse(lineas[lineas.length - 1]); // la respuesta es la última línea
        if (r.error) console.error('[documentos] PDF:', r.error);
        return r.error ? rechazar(error('No se pudo leer el PDF')) : resolver(r.texto || '');
      } catch (e) { console.error('[documentos] PDF sin respuesta válida:', String(e.message).slice(0, 200)); return rechazar(error('No se pudo leer el PDF')); }
    });
    hijo.stdin.on('error', () => {}); // el proceso pudo terminar antes de leer todo
    hijo.stdin.end(buf);
  });
}

async function leer(buf, nombre) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw error('El archivo está vacío');
  const ext = extension(nombre);
  if (!FORMATOS.includes(ext)) throw error(`Formato no admitido (${ext || 'sin extensión'}). Use: Excel (.xlsx), CSV, cronograma de MS Project en XML, PDF o Word (.docx)`);
  if ((ext === '.xlsx' || ext === '.docx') && !empieza(buf, 0x50, 0x4b, 0x03, 0x04)) throw error(`El archivo no es un ${ext} válido`);
  if (ext === '.pdf' && buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw error('El archivo no es un PDF válido');
  if ((ext === '.csv' || ext === '.xml') && buf.includes(0)) throw error(`El archivo no es un ${ext} de texto válido`);

  if (ext === '.xlsx') return { formato: 'xlsx', tipo: 'tablas', hojas: await leerXlsx(buf) };
  if (ext === '.csv') return { formato: 'csv', tipo: 'tablas', hojas: leerCsv(buf) };
  if (ext === '.xml') return { formato: 'project-xml', tipo: 'tablas', hojas: leerProjectXml(buf) };
  if (ext === '.docx') {
    const { value } = await require('mammoth').extractRawText({ buffer: buf }).catch(() => { throw error('No se pudo leer el Word'); });
    if (!value.trim()) throw error('El Word no tiene texto');
    return { formato: 'docx', tipo: 'texto', texto: value };
  }
  const texto = await textoDePdf(buf);
  if (!texto.trim()) throw error('El PDF no tiene texto (parece un documento escaneado); use Excel o CSV');
  return { formato: 'pdf', tipo: 'texto', texto };
}

module.exports = { leer, extension, FORMATOS };
