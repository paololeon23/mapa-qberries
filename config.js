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
  APP_VERSION: "1.1.2",

  LABOR_OPTS: {
    labor_ppto: [
      "ARENADO DE MACETAS", "ARREGLO DE CAMELLONES", "DESHIERBO", "LIMPIEZA DE PODA",
      "MANTENIMIENTO CERCOS VIVOS", "MANTENIMIENTO DE CERCOS VIVOS", "PROYECCIONES"
    ],
    labor_real: [
      "APLICACIÓN CON MOCHILA", "ARENADO DE MACETAS", "ARREGLO DE CAMELLONES", "DESHIERBO",
      "DESHIERBO/PALANA", "LAVADO DE PLANTAS", "PODA KING GRASS", "PROYECCIONES",
      "RETIRO DE PIEDRAS", "TUTORES"
    ]
  }
};
