'use strict';
const path = require('path');
const config = require('../config');

async function crearRepositorio() {
  if (config.modoDatos === 'sqlserver') {
    const faltan = ['servidor', 'usuario', 'clave'].filter((k) => !config.sqlserver[k]);
    if (faltan.length) throw new Error(`MODO_DATOS=sqlserver requiere SQL_${faltan.map((f) => f.toUpperCase()).join(', SQL_')} en el .env`);
    const { crearRepositorioSqlServer } = require('./sqlserver');
    return crearRepositorioSqlServer(config.sqlserver);
  }
  const { crearRepositorioMemoria } = require('./memoria');
  const semilla = require(path.join(config.raiz, 'data', 'semilla.json'));
  return crearRepositorioMemoria({ semilla, archivo: config.archivoDemo });
}

module.exports = { crearRepositorio };
