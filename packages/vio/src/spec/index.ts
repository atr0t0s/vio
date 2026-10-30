// Generative UI: agents describe screens as flat JSON specs built from a
// catalog of trusted components; specs are validated before they render.
export { defineCatalog, describeCatalog, DEFAULT_HTML } from './catalog'
export type { Catalog, CatalogEntry, PropDef, PropType } from './catalog'
export { validateSpec, formatErrors } from './validate'
export type { Spec, SpecNode, SpecError, ValidateOptions } from './validate'
export { specToNode, defineSpecView } from './render'
export type { SpecViewOptions } from './render'
