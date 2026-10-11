function handler(event) {
  var request = event.request;
  if (request.method !== 'HEAD' || request.uri !== '/__japan-access-check') return request;
  // This distribution requires Cloudflare AOP / viewer mTLS. Report only the trusted country code.
  var country = request.headers && request.headers['cf-ipcountry'];
  var value = country && /^[A-Z]{2}$/.test(country.value) &&
    (!country.multiValue || country.multiValue.length === 1 && country.multiValue[0].value === country.value) ? country.value : 'unknown';
  return {
    statusCode: 204,
    statusDescription: 'No Content',
    headers: {
      'cache-control': { value: 'private, no-store' },
      'x-kaiho-visitor-country': { value: value }
    }
  };
}
