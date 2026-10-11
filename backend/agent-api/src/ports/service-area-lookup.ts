export interface ServiceAreaLocation { country: string; prefecture: string }
export interface ServiceAreaLookup {
  resolve(input: { query?: string; latitude?: number; longitude?: number }): Promise<ServiceAreaLocation | undefined>;
}
