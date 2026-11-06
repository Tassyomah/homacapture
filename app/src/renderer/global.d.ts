import type { NarrateApi } from '../shared/types'
declare global { interface Window { narrate: NarrateApi } }
export {}
declare module '*.svg?url' { const url: string; export default url }
