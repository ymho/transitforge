import { serviceAreaAccommodations, type ServiceAreaPolicy } from "../usecases/service-area.js";
import { LambdaAccommodationProvider, type ProviderLambdaInvoker } from "../adapters/lambda-accommodation-provider.js";
import { createAccommodationSearchOperation } from "../usecases/accommodation-search.js";

/** Pass this operation to the Server Agent Tool binding at #480 cutover. No credentials here. */
export function createFixedEgressAccommodationOperation(functionArn: string, invoker?: ProviderLambdaInvoker, serviceArea?: ServiceAreaPolicy) {
  const provider = new LambdaAccommodationProvider(functionArn, invoker);
  return createAccommodationSearchOperation(serviceArea ? serviceAreaAccommodations(provider, serviceArea) : provider);
}
