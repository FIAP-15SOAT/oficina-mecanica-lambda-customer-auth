import { createServer, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface InternalServicesStubResponse {
  status: number;
  body?: object;
  headers?: Record<string, string>;
  delayMs?: number;
}

export interface InternalServicesStubRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface InternalServicesStub {
  url: string;
  /** Identity credentials by CPF (11 digits). */
  credentials: Map<string, { password: string; userId: string }>;
  /** Work order customers linked to each user, by userId. */
  userCustomers: Map<string, object[]>;
  requests: InternalServicesStubRequest[];
  /** One-shot answers keyed by "<METHOD> <path>", checked before any route. */
  nextResponses: Map<string, InternalServicesStubResponse>;
  close(): Promise<void>;
}

/** Answers one route from its path params and the parsed JSON body. */
type RouteHandler = (params: Record<string, string>, body: unknown) => InternalServicesStubResponse;

const unauthorized: InternalServicesStubResponse = {
  status: 401,
  body: { statusCode: 401, error: 'Unauthorized', message: 'Credenciais inválidas' },
};

const notFound = (path: string): InternalServicesStubResponse => ({
  status: 404,
  body: { statusCode: 404, error: 'Not Found', message: `Cannot ${path}` },
});

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }

  const text = Buffer.concat(chunks).toString('utf8');

  return text ? JSON.parse(text) : undefined;
}

/** Serves the Identity customer authentication and the work order user customers internal routes. */
export async function startInternalServicesStub(port = 0): Promise<InternalServicesStub> {
  const credentials = new Map<string, { password: string; userId: string }>();
  const userCustomers = new Map<string, object[]>();
  const requests: InternalServicesStubRequest[] = [];
  const nextResponses = new Map<string, InternalServicesStubResponse>();

  const routeTable: Record<string, RouteHandler> = {
    'POST /internal/customer-authentications': (_params, body) => {
      const { cpf, password } = body as { cpf: string; password: string };
      const credential = credentials.get(cpf);

      return credential?.password === password
        ? { status: 200, body: { data: { userId: credential.userId } } }
        : unauthorized;
    },
    'GET /internal/users/:userId/customers': ({ userId }) => ({
      status: 200,
      body: { data: userCustomers.get(userId) ?? [] },
    }),
  };

  const routes = Object.entries(routeTable).map(([route, handle]) => {
    const [method, pathname] = route.split(' ');

    return { method, pattern: new URLPattern({ pathname }), handle };
  });

  const answer = (method: string, path: string, body: unknown): InternalServicesStubResponse => {
    const { pathname } = new URL(path, 'http://localhost');

    for (const route of routes) {
      const match = route.method === method ? route.pattern.exec({ pathname }) : null;

      if (match) {
        // Every param is a required ":name" segment, so a match always captures it.
        return route.handle(match.pathname.groups as Record<string, string>, body);
      }
    }

    return notFound(`${method} ${path}`);
  };

  const server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const method = req.method ?? 'GET';
      const path = req.url ?? '/';
      const key = `${method} ${path}`;
      const response = nextResponses.get(key) ?? answer(method, path, body);

      nextResponses.delete(key);
      requests.push({ method, path, headers: req.headers, body });

      setTimeout(() => {
        res.writeHead(response.status, {
          'content-type': 'application/json',
          ...response.headers,
        });
        res.end(response.body && JSON.stringify(response.body));
      }, response.delayMs ?? 0);
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    credentials,
    userCustomers,
    requests,
    nextResponses,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // Drops the sockets a delayed answer still holds, so close() does not wait for them.
        server.closeAllConnections();
      }),
  };
}
