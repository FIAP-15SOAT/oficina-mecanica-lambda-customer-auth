import { EventEmitter } from 'node:events';
import pino from 'pino';

import { createDefaultDestination } from '@infrastructure/logging/logging-destination';
import { DESTINATION_FAILURE_POLICY } from '@infrastructure/logging/logging-diagnostics';
import { captureDiagnostics, DiagnosticsCapture } from '../../../helpers/diagnostics-capture';

describe('createDefaultDestination', () => {
  let destinationSpy: jest.SpyInstance;
  let stream: EventEmitter;
  let stderr: DiagnosticsCapture;

  beforeEach(() => {
    stream = new EventEmitter();
    destinationSpy = jest
      .spyOn(pino, 'destination')
      .mockReturnValue(stream as unknown as ReturnType<typeof pino.destination>);
    stderr = captureDiagnostics();
  });

  afterEach(() => {
    destinationSpy.mockRestore();
    stderr.restore();
  });

  /**
   * `sync: true` porque o buffer assíncrono perde as últimas linhas quando o
   * processo morre de repente — crash ou OOM kill —, que é quando elas importam.
   */
  it('should write synchronously to stdout', () => {
    createDefaultDestination();

    expect(destinationSpy).toHaveBeenCalledWith({ dest: 1, sync: true });
  });

  /**
   * Um evento `'error'` sem listener em stream do Node **derruba o processo**:
   * sem este handler, um `stdout` quebrado (EPIPE quando o coletor cai) faria o
   * logging matar a aplicação que ele existe para observar.
   */
  it('should register an error listener so a broken stdout cannot kill the process', () => {
    const destination = createDefaultDestination();

    expect((destination as unknown as EventEmitter).listenerCount('error')).toBe(1);
  });

  /**
   * O diagnóstico de destino é disparado **uma vez por processo** — um stdout
   * quebrado emitiria `error` a cada escrita, e repetir a linha em stderr seria
   * trocar o silêncio por uma inundação. Por isso a asserção vive num teste só.
   */
  it('should absorb the write error and report the declared failure policy once', () => {
    createDefaultDestination();

    expect(() => stream.emit('error', new Error('EPIPE'))).not.toThrow();

    const diagnostic = String(stderr.spy.mock.calls[0][0]);

    expect(diagnostic).toContain('"oficina.logging.failure.stage":"destination"');
    expect(diagnostic).toContain(DESTINATION_FAILURE_POLICY);

    stream.emit('error', new Error('EPIPE'));

    expect(stderr.spy).toHaveBeenCalledTimes(1);
  });
});
