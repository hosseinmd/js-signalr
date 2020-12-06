// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.

import { HttpResponse } from "../src/HttpClient";
import { TransferFormat } from "../src/ITransport";
import { LongPollingTransport } from "../src/LongPollingTransport";
import { getUserAgentHeader } from "../src/Utils";

import { VerifyLogger } from "./Common";
import { TestHttpClient } from "./TestHttpClient";
import {
  PromiseSource,
  registerUnhandledRejectionHandler,
  SyncPoint,
} from "./Utils";

registerUnhandledRejectionHandler();

describe("LongPollingTransport", () => {
  it("shuts down polling by aborting in-progress request", async () => {
    await VerifyLogger.run(async (logger) => {
      let firstPoll = true;
      const pollCompleted = new PromiseSource();
      const client = new TestHttpClient()
        .on("GET", async (r) => {
          if (firstPoll) {
            firstPoll = false;
            return new HttpResponse(200);
          } else {
            // Turn 'onabort' into a promise.
            const abort = new Promise((resolve) => {
              if (r.abortSignal!.aborted) {
                //@ts-ignore
                resolve();
              } else {
                //@ts-ignore
                r.abortSignal!.onabort = resolve;
              }
            });
            await abort;

            // Signal that the poll has completed.
            pollCompleted.resolve();

            return new HttpResponse(200);
          }
        })
        .on("DELETE", () => new HttpResponse(202));
      const transport = new LongPollingTransport(
        client,
        undefined,
        logger,
        false,
        true,
        {},
      );

      await transport.connect("http://example.com", TransferFormat.Text);
      const stopPromise = transport.stop();

      await pollCompleted.promise;

      await stopPromise;
    });
  });

  it("204 server response stops polling and raises onClose", async () => {
    await VerifyLogger.run(async (logger) => {
      let firstPoll = true;
      const client = new TestHttpClient().on("GET", async () => {
        if (firstPoll) {
          firstPoll = false;
          return new HttpResponse(200);
        } else {
          // A 204 response will stop the long polling transport
          return new HttpResponse(204);
        }
      });
      const transport = new LongPollingTransport(
        client,
        undefined,
        logger,
        false,
        true,
        {},
      );

      const stopPromise = makeClosedPromise(transport);

      await transport.connect("http://example.com", TransferFormat.Text);

      // Close will be called on transport because of 204 result from polling
      await stopPromise;
    });
  });

  it("sends DELETE on stop after polling has finished", async () => {
    await VerifyLogger.run(async (logger) => {
      let firstPoll = true;
      let deleteSent = false;
      const pollingPromiseSource = new PromiseSource();
      const deleteSyncPoint = new SyncPoint();
      const httpClient = new TestHttpClient()
        .on("GET", async () => {
          if (firstPoll) {
            firstPoll = false;
            return new HttpResponse(200);
          } else {
            await pollingPromiseSource.promise;
            return new HttpResponse(204);
          }
        })
        .on("DELETE", async () => {
          deleteSent = true;
          await deleteSyncPoint.waitToContinue();
          return new HttpResponse(202);
        });

      const transport = new LongPollingTransport(
        httpClient,
        undefined,
        logger,
        false,
        true,
        {},
      );

      await transport.connect("http://tempuri.org", TransferFormat.Text);

      // Begin stopping transport
      const stopPromise = transport.stop();

      // Delete will not be sent until polling is finished
      expect(deleteSent).toEqual(false);

      // Allow polling to complete
      pollingPromiseSource.resolve();

      // Wait for delete to be called
      await deleteSyncPoint.waitForSyncPoint();

      expect(deleteSent).toEqual(true);

      deleteSyncPoint.continue();

      // Wait for stop to complete
      await stopPromise;
    });
  });

  it("user agent header set on sends and polls", async () => {
    await VerifyLogger.run(async (logger) => {
      let firstPoll = true;
      let firstPollUserAgent = "";
      let secondPollUserAgent = "";
      let deleteUserAgent = "";
      const pollingPromiseSource = new PromiseSource();
      const httpClient = new TestHttpClient()
        .on("GET", async (r) => {
          if (firstPoll) {
            firstPoll = false;
            firstPollUserAgent = r.headers![`User-Agent`];
            return new HttpResponse(200);
          } else {
            secondPollUserAgent = r.headers![`User-Agent`];
            await pollingPromiseSource.promise;
            return new HttpResponse(204);
          }
        })
        .on("DELETE", async (r) => {
          deleteUserAgent = r.headers![`User-Agent`];
          return new HttpResponse(202);
        });

      const transport = new LongPollingTransport(
        httpClient,
        undefined,
        logger,
        false,
        true,
        {},
      );

      await transport.connect("http://tempuri.org", TransferFormat.Text);

      // Begin stopping transport
      const stopPromise = transport.stop();

      // Allow polling to complete
      pollingPromiseSource.resolve();

      // Wait for stop to complete
      await stopPromise;

      const [, value] = getUserAgentHeader();
      expect(firstPollUserAgent).toEqual(value);
      expect(deleteUserAgent).toEqual(value);
      expect(secondPollUserAgent).toEqual(value);
    });
  });

  it("overwrites library headers with user headers", async () => {
    await VerifyLogger.run(async (logger) => {
      const headers = { "User-Agent": "Custom Agent", "X-HEADER": "VALUE" };
      let firstPoll = true;
      let firstPollUserAgent = "";
      let firstUserHeader = "";
      let secondPollUserAgent = "";
      let secondUserHeader = "";
      let deleteUserAgent = "";
      let deleteUserHeader = "";
      const pollingPromiseSource = new PromiseSource();
      const httpClient = new TestHttpClient()
        .on("POST", async (r) => {
          expect(r.content).toEqual({ message: "hello" });
          expect(r.headers).toEqual(headers);
          expect(r.method).toEqual("POST");
          expect(r.url).toEqual("http://tempuri.org");
        })
        .on("GET", async (r) => {
          if (firstPoll) {
            firstPoll = false;
            firstPollUserAgent = r.headers!["User-Agent"];
            firstUserHeader = r.headers!["X-HEADER"];
            return new HttpResponse(200);
          } else {
            secondPollUserAgent = r.headers!["User-Agent"];
            secondUserHeader = r.headers!["X-HEADER"];
            await pollingPromiseSource.promise;
            return new HttpResponse(204);
          }
        })
        .on("DELETE", async (r) => {
          deleteUserAgent = r.headers!["User-Agent"];
          deleteUserHeader = r.headers!["X-HEADER"];
          return new HttpResponse(202);
        });

      const transport = new LongPollingTransport(
        httpClient,
        undefined,
        logger,
        false,
        true,
        headers,
      );

      await transport.connect("http://tempuri.org", TransferFormat.Text);

      await transport.send({ message: "hello" });

      // Begin stopping transport
      const stopPromise = transport.stop();

      // Allow polling to complete
      pollingPromiseSource.resolve();

      // Wait for stop to complete
      await stopPromise;

      expect(firstPollUserAgent).toEqual("Custom Agent");
      expect(deleteUserAgent).toEqual("Custom Agent");
      expect(secondPollUserAgent).toEqual("Custom Agent");
      expect(firstUserHeader).toEqual("VALUE");
      expect(secondUserHeader).toEqual("VALUE");
      expect(deleteUserHeader).toEqual("VALUE");
    });
  });
});

function makeClosedPromise(transport: LongPollingTransport): Promise<void> {
  const closed = new PromiseSource();
  transport.onclose = (error) => {
    if (error) {
      closed.reject(error);
    } else {
      closed.resolve();
    }
  };
  return closed.promise;
}
