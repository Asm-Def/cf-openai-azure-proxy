
function getEnv(env) {
  // The name of your Azure OpenAI Resource.
  const resourceName=env.RESOURCE_NAME;
  // The deployment name you chose when you deployed the model.
  const mapper = {
      'gpt-3.5-turbo': env.DEPLOY_NAME_GPT35,
      'gpt-3.5-turbo-16k': env.DEPLOY_NAME_GPT35_16K,
      'gpt-4': env.DEPLOY_NAME_GPT4,
      'gpt-4-32k': env.DEPLOY_NAME_GPT4_32K,
      'text-embedding-ada-002': env.DEPLOY_NAME_EMBEDDING
  };
  return { resourceName, mapper };
}


const apiVersion="2023-08-01-preview"

addEventListener("fetch", (event, env, ctx) => {
  event.respondWith(handleRequest(event.request, env, ctx));
});

async function handleRequest(request, env, ctx) {
  if (request.method === 'OPTIONS') {
    return handleOPTIONS(request)
  }

  const { resourceName, mapper } = getEnv(env);

  const url = new URL(request.url);
  if (url.pathname.startsWith("//")) {
    url.pathname = url.pathname.replace('/',"")
  }
  if (url.pathname === '/v1/chat/completions') {
    var path="chat/completions"
  } else if (url.pathname === '/v1/completions') {
    var path="completions"
  } else if (url.pathname === '/v1/models') {
    return handleModels(request, mapper)
  } // from https://github.com/haibbo/cf-openai-azure-proxy/pull/33
  else if (url.pathname === '/v1/embeddings') {
    var path="embeddings"
  } else if (url.pathname === '/v1/moderations') {
    const json = JSON.stringify({"id": "modr-placeholder",
      "model": "text-moderation-001",
      "results": [{"flagged": false},]}, null, 2);
    return new Response(json, {
      headers: { 'Content-Type': 'application/json' },
    });
  } else {
    return new Response('404 Not Found', { status: 404 })
  }

  let body;
  if (request.method === 'POST') {
    body = await request.json();
  }

  const modelName = body?.model;  
  const deployName = mapper[modelName] || '' 

  if (deployName === '') {
    return new Response('Missing model mapper', {
        status: 403
    });
  }
  const fetchAPI = `https://${resourceName}.openai.azure.com/openai/deployments/${deployName}/${path}?api-version=${apiVersion}`

  const authKey = request.headers.get('Authorization');
  if (!authKey) {
    return new Response("Not allowed", {
      status: 403
    });
  }

  const payload = {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      "api-key": authKey.replace('Bearer ', ''),
    },
    body: typeof body === 'object' ? JSON.stringify(body) : '{}',
  };

  let response 
  try {
    response = await fetch(fetchAPI, payload);
    response = new Response(response.body, response);
    response.headers.set("Access-Control-Allow-Origin", "*");
  } catch (e) {
    console.error(e)
    response = new Response(`An error occurred when processing your request, please try again later. Error: ${e.message}`, {
      status: 500
    });
  }
  
  if (body?.stream != true){
    return response
  } 

  let { readable, writable } = new TransformStream()
  stream(response.body, writable);
  return new Response(readable, response);

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// support printer mode and add newline
async function stream(readable, writable) {
  const reader = readable.getReader();
  const writer = writable.getWriter();

  // const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  // let decodedValue = decoder.decode(value);
  const newline = "\n";
  const delimiter = "\n\n"
  const encodedNewline = encoder.encode(newline);

  let buffer = "";
  while (true) {
    let { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true }); // stream: true is important here,fix the bug of incomplete line
    let lines = buffer.split(delimiter);

    // Loop through all but the last line, which may be incomplete.
    for (let i = 0; i < lines.length - 1; i++) {
      await writer.write(encoder.encode(lines[i] + delimiter));
      await sleep(20);
    }

    buffer = lines[lines.length - 1];
  }

  if (buffer) {
    await writer.write(encoder.encode(buffer));
  }
  await writer.write(encodedNewline)
  await writer.close();
}

async function handleModels(request, mapper) {
  const data = {
    "object": "list",
    "data": []  
  };

  for (let key in mapper) {
    data.data.push({
      "id": key,
      "object": "model",
      "created": 1677610602,
      "owned_by": "openai",
      "permission": [{
        "id": "modelperm-M56FXnG1AsIr3SXq8BYPvXJA",
        "object": "model_permission",
        "created": 1679602088,
        "allow_create_engine": false,
        "allow_sampling": true,
        "allow_logprobs": true,
        "allow_search_indices": false,
        "allow_view": true,
        "allow_fine_tuning": false,
        "organization": "*",
        "group": null,
        "is_blocking": false
      }],
      "root": key,
      "parent": null
    });  
  }

  const json = JSON.stringify(data, null, 2);
  return new Response(json, {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleOPTIONS(request) {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*'
      }
    })
}
