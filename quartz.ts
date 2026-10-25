import { viewRegistry } from "@quartz-community/bases-page"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import {
  groupedCardsRegistration,
  tableDescRegistration,
} from "./quartz/plugins/views/grouped-cards"
import { reviewCardsRegistration } from "./quartz/plugins/views/review-cards"

viewRegistry.register(groupedCardsRegistration)
viewRegistry.register(tableDescRegistration)
viewRegistry.register(reviewCardsRegistration)

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
