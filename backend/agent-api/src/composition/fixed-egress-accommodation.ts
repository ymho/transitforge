import { LambdaAccommodationProvider, type ProviderLambdaInvoker } from "../adapters/lambda-accommodation-provider.js";
import { createAccommodationSearchOperation } from "../usecases/accommodation-search.js";

/** Pass this operation to the Server Agent Tool binding at #480 cutover. No credentials here. */
export function createFixedEgressAccommodationOperation(functionArn: string, invoker?: ProviderLambdaInvoker) {
  return createAccommodationSearchOperation(new LambdaAccommodationProvider(functionArn, invoker));
}
