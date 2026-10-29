/** Configuración compartida · mapa (index) + formulario móvil (form.html) */
window.QB_CONFIG = {
  // URL del Web App de Google Apps Script (.../exec)
  API_URL: "https://script.google.com/macros/s/AKfycbyMsvkvDiSwOVd-adNdKvnLWBAop4dPIBnPKU_Z5A3yaVGtt7dTtNfEX_T08RWLj9x3IA/exec",

  /**
   * SEGURIDAD (obligatorio en producción):
   * 1) En Apps Script → Configuración del proyecto → Propiedades del script
   *    cree API_TOKEN = (cadena larga aleatoria, 32+ chars)
   * 2) Pegue el MISMO valor aquí en API_TOKEN
   * Opcional en Script Properties: MAX_BATCH=40 · LABOR_ALLOWLIST=LABOR1|LABOR2|...
   */
  API_TOKEN: "",

  /** Tope de lotes por guardado grupal (frontend + backend) */
  MAX_BATCH: 40,

  BRAND: "Q Berries",
  APP_NAME: "Q Berries · Labores",
  APP_VERSION: "1.3.36",

  LABOR_OPTS: {
    labor_ppto: [
      "ARENADO DE MACETAS", "ARREGLO DE CAMELLONES", "DESHIERBO", "LIMPIEZA DE PODA",
      "MANTENIMIENTO CERCOS VIVOS", "MANTENIMIENTO DE CERCOS VIVOS", "PROYECCIONES"
    ],
    labor_real: [
      "DESHIERBO",
      "ARENADO DE MACETAS",
      "CERCOS VIVOS"
    ]
  },

  /** Cercos vivos: lotes con 20% extra abajo (además del 20% de arriba) */
  CERCOS_FOOT_LOTS: [
    "T6|24", "T3|13", "T3|12", "T3|11", "T3|10", "T7|29",
    "T16|245", "T16|244", "T15|243", "T15|242",
    "T10|221", "T10|222", "T10M|223", "T10M|224",
    "T8M|214", "T8M|213",
    "T1|212", "T7|212", "T1|211", "T7|211",
    "T7|210", "T7|208|0.46",
    "T8|86", "T8|85", "T8|276",
    "T9|90",
    "T8|84", "T8|83", "T8|82", "T8|81",
    "T4|68", "T4|67", "T4|66", "T4|64",
    "T3|63", "T3|62", "T3|59", "T3|58"
  ],

  /** Paleta de avance semanal: un color por día hábil (se guarda el nombre en la hoja) */
  COLOR_PALETTE: {
    "#64B5F6": "Lunes",
    "#81C784": "Martes",
    "#FFD54F": "Miercoles",
    "#FF8A65": "Jueves",
    "#CE93D8": "Viernes"
  }
};
