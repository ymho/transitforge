function handler(event) {
  var request = event.request;
  // This function is attached only to the Cloudflare AOP / required-mTLS distribution.
  var country = request.headers && request.headers['cf-ipcountry'];
  if (country && country.value === 'JP' && (!country.multiValue || country.multiValue.length === 1 && country.multiValue[0].value === 'JP')) {
    return request;
  }
  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: {
      'cache-control': { value: 'private, no-store' },
      'content-type': { value: 'application/json; charset=utf-8' }
    },
    body: JSON.stringify({ code: 'country_not_supported', message: '日本国内からのみご利用いただけます。' })
  };
}
