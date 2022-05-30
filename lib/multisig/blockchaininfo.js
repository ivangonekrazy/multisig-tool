"use strict";

const constants = require('./constants');
const queue = [];
let inFlight = 0;
let backoff = constants.REQUEST_BACKOFF;
let pipelineSize = constants.REQUEST_PIPELINE_SIZE;
let processTimeout;

/***
  Blockchain.info API wrapper
  With additional logic to handle parallel requests slowly due to ratelimiting
***/
var BlockchainInfo = {
  getUnspentOutputs: function(address) {
    return BlockchainInfo.get("unspent?active=" + address);
  },
  get: function(url) {
    // We need to return a promise
    const req = new $.Deferred();

    // Store some request related information on the promise object
    req.url = url;
    req.requestedTimes = 0;

    // Enqueue request
    queue.push(req);

    // Kick off queue processing
    BlockchainInfo.processQueue();

    return req;
  },
  processQueue: function() {
    if (!queue.length) {
      return;
    }

    // Ensure only `pipelineSize` parallel requests
    if (inFlight >= pipelineSize) {
      BlockchainInfo.delayedProcessQueue();
      return;
    }

    const req = queue.shift();
    BlockchainInfo.processReq(req);
  },
  delayedProcessQueue: function() {
    if (processTimeout) clearTimeout(processTimeout);
    processTimeout = setTimeout(BlockchainInfo.processQueue, backoff);
  },
  processReq: function(req) {
    inFlight = inFlight + 1;
    req.requestedTimes = req.requestedTimes + 1;

    // Fetch BlockchainInfo API
    $.get(constants.BLOCKCHAININFO_API_URL_ROOT + req.url)
    .done(function(res) {
      // Resolve outer promise
      req.resolve(res);
    })
    .fail(function() {
      // Requeue if under threshold, to handle ratelimits
      //
      // BlockchainInfo API doesn't return CORS headers on non-200 responses,
      // we can't check the error status code at all here.
      if (req.requestedTimes < constants.REQUEST_RETRY_ATTEMPTS) {
        if (backoff < constants.REQUEST_BACKOFF_CEILING) {
          backoff = backoff * constants.REQUEST_BACKOFF_MULTIPLIER; // Exponential backoff
        }

        return queue.push(req);
      }

      // If retries exhausted, reject outer promise
      req.reject();
    })
    .always(function() {
      inFlight = inFlight - 1;
      BlockchainInfo.delayedProcessQueue(); // Try processing more!
    });

    // Immediately try processing more!
    BlockchainInfo.processQueue();
  }
}

module.exports = BlockchainInfo;
