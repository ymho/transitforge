import { createAgentApplication } from "./composition-root.js";
import { createAgentApiHandler } from "./handler.js";

const application = createAgentApplication();

export const handler = createAgentApiHandler(application, {
  log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
});
