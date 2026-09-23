// CloudFront viewer-request function (cloudfront-js-2.0) for injoffice.com.
// Pages are served at clean URLs: /agents serves agents.html and /docs/guide/ serves
// /docs/guide/index.html. Old .html addresses answer with a permanent redirect to the clean
// one, so links and search results keep working and each page has a single canonical URL.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var query = serializeQuery(request.querystring);

  function redirect(path, fragment) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: path + query + (fragment || '') },
        'cache-control': { value: 'public, max-age=3600' },
      },
    };
  }

  // Comparison pages were removed on purpose; tell crawlers they are gone for good.
  if (uri === '/compare' || uri.slice(0, 9) === '/compare/') {
    return { statusCode: 410, statusDescription: 'Gone', headers: { 'cache-control': { value: 'public, max-age=3600' } } };
  }
  // The download page now lives on the home page.
  if (uri === '/download' || uri === '/download.html') return redirect('/', '#download');
  // A directory without its slash would otherwise resolve to /docs.html.
  if (uri === '/docs') return redirect('/docs/');
  if (uri.slice(-11) === '/index.html') return redirect(uri.slice(0, -10));
  if (uri.slice(-5) === '.html') return redirect(uri.slice(0, -5));

  if (uri.slice(-1) === '/') {
    request.uri = uri + 'index.html';
  } else if (uri.split('/').pop().indexOf('.') === -1) {
    request.uri = uri + '.html';
  }
  return request;
}

function serializeQuery(querystring) {
  var parts = [];
  for (var key in querystring) {
    var entry = querystring[key];
    var values = entry.multiValue ? entry.multiValue.map(function (item) { return item.value; }) : [entry.value];
    for (var i = 0; i < values.length; i++) {
      parts.push(values[i] === '' ? key : key + '=' + values[i]);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}
