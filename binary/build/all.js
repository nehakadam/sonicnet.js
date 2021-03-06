(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
function RingBuffer(maxLength) {
  this.array = [];
  this.maxLength = maxLength;
}

RingBuffer.prototype.get = function(index) {
  if (index >= this.array.length) {
    return null;
  }
  return this.array[index];
};

RingBuffer.prototype.last = function() {
  if (this.array.length == 0) {
    return null;
  }
  return this.array[this.array.length - 1];
}

RingBuffer.prototype.add = function(value) {
  // Append to the end, remove from the front.
  this.array.push(value);
  if (this.array.length >= this.maxLength) {
    this.array.splice(0, 1);
  }
};

RingBuffer.prototype.length = function() {
  // Return the actual size of the array.
  return this.array.length;
};

RingBuffer.prototype.clear = function() {
  this.array = [];
};

RingBuffer.prototype.copy = function() {
  // Returns a copy of the ring buffer.
  var out = new RingBuffer(this.maxLength);
  out.array = this.array.slice(0);
  return out;
};

RingBuffer.prototype.remove = function(index, length) {
  //console.log('Removing', index, 'through', index+length);
  this.array.splice(index, length);
};

module.exports = RingBuffer;

},{}],2:[function(require,module,exports){
/**
 * A simple sonic encoder/decoder for [a-z0-9] => frequency (and back).
 * A way of representing characters with frequency.
 */
var BITS = '01234567';

function SonicCoder(params) {
  params = params || {};
  this.mode = params.mode || 0;
  this.freqMin = params.freqMin || 18500;
  this.freqMax = params.freqMax || 19500;
  this.freqError = params.freqError || 50;
  this.bitString = params.bits || BITS;
  this.startChar = params.startChar || '^';
  this.endChar = params.endChar || '$';
  this.sepChar = params.sepChar || '¥';
  // Make sure that the bits has the start and end chars.
  this.bits = this.startChar + this.bitString + this.endChar + (this.mode == 0 ? this.sepChar : "");
  // 指定帯域を区切る数(+1はsepChar用)
  if (this.mode == 0) {
    this.bitsLength = this.bits.length;
  } else {
    this.bitsLength = Math.ceil(this.bits.length / 2) + 1;
  }
}

SonicCoder.prototype.isModeFreqBin = function() {
  return this.mode == 1;
}

/**
 * Given a character, convert to the corresponding frequency.
 */
SonicCoder.prototype.charToFreq = function(char) {
  // Get the index of the character.
  var index;
  if (this.isModeFreqBin() && char == this.sepChar) {
    index = this.bitsLength - 1;
  } else {
    index = this.bits.indexOf(char);
    if (index == -1) {
      // If this character isn't in the bits, error out.
      console.error(char, 'is an invalid character.');
      index = this.bits.length - 1;
    }
    if (this.isModeFreqBin()) {
      // バイナリ化した際のindex
      index = index % (this.bitsLength - 1);
    }
  }

  // Convert from index to frequency.
  var freqRange = this.freqMax - this.freqMin;
  var percent = index / this.bitsLength;
  var freqOffset = Math.round(freqRange * percent);
  return this.freqMin + freqOffset;
};

/**
 * バイナリ化した際の0,1どちらなのか
 */
SonicCoder.prototype.charToBin = function(char) {
  // Get the index of the character.
    var index;
  if (this.isModeFreqBin() && char == this.sepChar) {
    index = this.bitsLength - 1;
  } else {
    index = this.bits.indexOf(char);
    if (index == -1) {
      // If this character isn't in the bits, error out.
      console.error(char, 'is an invalid character.');
      index = this.bits.length - 1;
    }
  }
  // バイナリ化した際の0,1どちらなのか
  return Math.floor(index / (this.bitsLength - 1));
};

/**
 * Given a frequency, convert to the corresponding character.
 */
SonicCoder.prototype.freqToChar = function(freq, bin) {
  // If the frequency is out of the range.
  if (!(this.freqMin < freq && freq < this.freqMax)) {
    // If it's close enough to the min, clamp it (and same for max).
    if (this.freqMin - freq < this.freqError) {
      freq = this.freqMin;
    } else if ((freq - this.freqMax) < this.freqError && (freq - this.freqMax) > 0) {
      freq = this.freqMax;
    } else {
      // Otherwise, report error.
      console.error(freq, 'is out of range.');
      return null;
    }
    console.warn("correction freq:", freq);
  }
  // Convert frequency to index to char.
  var freqRange = this.freqMax - this.freqMin;
  var percent = (freq - this.freqMin) / freqRange;
  var index = Math.round(this.bitsLength * percent);
  if (this.isModeFreqBin()) {
    if (index == (this.bitsLength - 1)) {
      return this.sepChar;
    } else if (bin == 1 && index < (this.bits.length - 1)) {
      index += this.bitsLength - 1;
    }
    return this.bits[index];
  } else {
    return this.bits[index];
  }
};

module.exports = SonicCoder;

},{}],3:[function(require,module,exports){
var RingBuffer = require('./ring-buffer.js');
var SonicCoder = require('./sonic-coder.js');

var audioContext = new window.AudioContext || new webkitAudioContext();

/**
 * Extracts meaning from audio streams.
 *
 * (assumes audioContext is an AudioContext global variable.)
 *
 * 1. Listen to the microphone.
 * 2. Do an FFT on the input.
 * 3. Extract frequency peaks in the ultrasonic range.
 * 4. Keep track of frequency peak history in a ring buffer.
 * 5. Call back when a peak comes up often enough.
 */
function SonicServer(params) {
  var self = this;
  params = params || {};
  this.bits = params.bits;
  this.mode = params.mode || 0;
  this.fps = params.fps || 60;
  this.peakThreshold = params.peakThreshold || -65;
  this.minRunLength = params.minRunLength || 2;
  this.coder = params.coder || new SonicCoder(params);
  this.charDuration = params.charDuration || 0.2;
  // How long (in ms) to wait for the next character.
  this.timeout = params.timeout || 300;
  this.debug = !!params.debug;

  this.peakHistory = new RingBuffer(params.bufferLength || 16);
  this.peakTimes = new RingBuffer(params.bufferLength || 16);

  this.callbacks = {};

  this.buffer = '';
  this.state = State.IDLE;
  this.isRunning = false;
  this.iteration = 0;
  this.startTime = null;
  this.fftSize = params.fftSize || 2048;
  this.debugFftBuffer = new RingBuffer(params.debugFftBufferSize || 256);
  if (this.debug) {
    window.setInterval(function(){
      console.debug("Avg fft time:",
        self.debugFftBuffer.array.reduce(function(v, i){return v + i}) / self.debugFftBuffer.length(),
        "ms",
        `(fftSize: ${self.fftSize})`);
    }, 5000);
  }
}

var State = {
  IDLE: 1,
  RECV: 2
};

SonicServer.prototype.isModeFreqBin = function() {
  return this.mode == 1;
}

/**
 * Start processing the audio stream.
 */
SonicServer.prototype.start = function() {
  // Start listening for microphone. Continue init in onStream.
  var constraints = {
    audio: { optional: [{ echoCancellation: false }] }
  };
  if (navigator.webkitGetUserMedia) {
    navigator.webkitGetUserMedia(constraints,
        this.onStream_.bind(this), this.onStreamError_.bind(this));
  } else if (navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia(constraints).then(this.onStream_.bind(this)).catch(this.onStreamError_.bind(this));
  }
};

/**
 * Stop processing the audio stream.
 */
SonicServer.prototype.stop = function() {
  this.isRunning = false;
  this.track.stop();
};

SonicServer.prototype.on = function(event, callback) {
  if (event == 'message') {
    this.callbacks.message = callback;
  }
  if (event == 'character') {
    this.callbacks.character = callback;
  }
};

SonicServer.prototype.setDebug = function(value) {
  this.debug = value;

  var canvas = document.querySelector('canvas');
  if (canvas) {
    // Remove it.
    canvas.parentElement.removeChild(canvas);
  }
};

SonicServer.prototype.fire_ = function(callback, arg) {
  if (typeof(callback) === 'function') {
    callback(arg);
  }
};

SonicServer.prototype.onStream_ = function(stream) {
  // Store MediaStreamTrack for stopping later. MediaStream.stop() is deprecated
  // See https://developers.google.com/web/updates/2015/07/mediastream-deprecations?hl=en
  this.track = stream.getTracks()[0];

  // Setup audio graph.
  var input = audioContext.createMediaStreamSource(stream);
  var analyser = audioContext.createAnalyser();
  analyser.fftSize = this.fftSize;
  input.connect(analyser);
  // Create the frequency array.
  this.freqs = new Float32Array(analyser.frequencyBinCount);
  // Save the analyser for later.
  this.analyser = analyser;
  this.isRunning = true;
  // Do an FFT and check for inaudible peaks.
  this.raf_(this.loop.bind(this));
};

SonicServer.prototype.onStreamError_ = function(e) {
  console.error('Audio input error:', e);
};

/**
 * Given an FFT frequency analysis, return the peak frequency in a frequency
 * range.
 */
SonicServer.prototype.getPeakFrequency = function() {
  // Find where to start.
  var start = this.freqToIndex(this.coder.freqMin);
  // TODO: use first derivative to find the peaks, and then find the largest peak.
  // Just do a max over the set.
  var max = -Infinity;
  var index = -1;
  for (var i = start; i < this.freqs.length; i++) {
    if (this.freqs[i] > max) {
      max = this.freqs[i];
      index = i;
    }
  }
  // Only care about sufficiently tall peaks.
  if (max > this.peakThreshold) {
    return [this.indexToFreq(index), max];
  }
  return null;
};

SonicServer.prototype.loop = function() {
  var st = window.performance.now();
  this.analyser.getFloatFrequencyData(this.freqs);
  this.debugFftBuffer.add(window.performance.now() - st);
  // Sanity check the peaks every 5 seconds.
  if ((this.iteration + 1) % (60 * 5) == 0) {
    this.restartServerIfSanityCheckFails();
  }
  // Calculate peaks, and add them to history.
  var freqInfo = this.getPeakFrequency();
  if (freqInfo) {
    var char = this.coder.freqToChar(freqInfo[0]);
    // DEBUG ONLY: Output the transcribed char.
    if (this.debug) {
      console.log('Transcribed char: ' + char + ', freq:' + freqInfo[0] + ', max: ' + freqInfo[1]);
    }
    this.peakHistory.add(char);
    this.peakTimes.add(new Date());
  } else {
    // If no character was detected, see if we've timed out.
    var lastPeakTime = this.peakTimes.last();
    if (lastPeakTime && new Date() - lastPeakTime > this.timeout) {
      // Last detection was over 300ms ago.
      this.state = State.IDLE;
      if (this.debug) {
        console.log('Token', this.buffer, 'timed out. duration:', (window.performance.now() - this.startTime), "ms");
      }
      this.startTime = null;
      this.peakTimes.clear();
      this.peakHistory.clear();
    }
  }
  // Analyse the peak history.
  this.analysePeaks();
  // DEBUG ONLY: Draw the frequency response graph.
  if (this.debug) {
    this.debugDraw_();
  }
  if (this.isRunning) {
    this.raf_(this.loop.bind(this));
  }
  this.iteration += 1;
};

SonicServer.prototype.indexToFreq = function(index) {
  var nyquist = audioContext.sampleRate/2;
  return nyquist/this.freqs.length * index;
};

SonicServer.prototype.freqToIndex = function(frequency) {
  var nyquist = audioContext.sampleRate/2;
  return Math.round(frequency/nyquist * this.freqs.length);
};

/**
 * Analyses the peak history to find true peaks (repeated over several frames).
 */
SonicServer.prototype.analysePeaks = function() {
  // Look for runs of repeated characters.
  var char = this.getLastRun();
  if (!char) {
    return;
  }
  if (this.state == State.IDLE) {
    // If idle, look for start character to go into recv mode.
    if (char[0] == this.coder.startChar) {
      this.buffer = '';
      this.state = State.RECV;
      this.startTime = window.performance.now();
    }
  } else if (this.state == State.RECV) {
    // 文字変更があった場合は書き換える
    if (char[1]) {
      var replacer = (char[0] == this.coder.endChar) ? "" : char[0];
      var ary = this.buffer.split("");
      ary[ary.length - 1] = replacer;
      this.buffer = ary.join("");
      this.fire_(this.callbacks.character, replacer);
    } else {
      // If receiving, look for character changes.
      if (char[0] != this.lastChar &&
          char[0] != this.coder.startChar && char[0] != this.coder.endChar) {
        if (char[0] != this.coder.sepChar) {
          this.buffer += char[0];
        }
        this.lastChar = char[0];
        this.fire_(this.callbacks.character, char[0]);
      }
    }
    // Also look for the end character to go into idle mode.
    if (char[0] == this.coder.endChar) {
      this.state = State.IDLE;
      var duration = Math.round(window.performance.now() - this.startTime);
      // 8文字なら一文字には3bitの情報が入っているという前提
      // 文字数の2の対数bit
      var bps = Math.round((this.buffer.length * Math.log2(this.bits.length)) / (duration / 1000));
      console.log("Duration: ", duration, "ms ", bps, "bps");
      this.fire_(this.callbacks.message, `${this.buffer}, duration(${duration}ms), ${bps}bps`);
      this.buffer = '';
      this.startTime = null;
      this.peakTimes.clear();
      this.peakHistory.clear();
    }
  }
};

SonicServer.prototype.getLastRun = function() {
  var lastChar = this.peakHistory.last();
  var runLength = 1;

  if (lastChar == this.coder.sepChar) {
    this.peakHistory.remove(this.peakHistory.length - 1, 1);
    return [lastChar, false];
  }

  // Look at the peakHistory array for patterns like ajdlfhlkjxxxxxx$.
  for (var i = this.peakHistory.length() - 2; i >= 0; i--) {
    var char = this.peakHistory.get(i);
    if (char == lastChar) {
      runLength += 1;
    } else {
      break;
    }
  }
  if (runLength >= this.minRunLength) {

    // second per frame
    var spf = 1000 / this.fps;
    var durationMs = runLength * spf;
    // console.log("Duration: ", durationMs, " ms");
    var changed = false;
    if (this.isModeFreqBin() && durationMs >= this.charDuration * 1000 * 2) {
      changed = true;
      var freq = this.coder.charToFreq(lastChar);
      changedChar = this.coder.freqToChar(freq, 1);
      console.log('Changed transcribed char: ', changedChar, " from ", lastChar);
      // Remove it from the buffer.
      this.peakHistory.remove(i + 1, runLength + 1);
      lastChar = changedChar;
    }

    return [lastChar, changed];
  }
  return null;
};

/**
 * DEBUG ONLY.
 */
SonicServer.prototype.debugDraw_ = function() {
  var canvas = document.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
  }
  canvas.width = document.body.offsetWidth;
  canvas.height = 480;
  drawContext = canvas.getContext('2d');
  // Plot the frequency data.
  for (var i = 0; i < this.freqs.length; i++) {
    var value = this.freqs[i];
    // Transform this value (in db?) into something that can be plotted.
    var height = value + 400;
    var offset = canvas.height - height - 1;
    var barWidth = canvas.width/this.freqs.length;
    drawContext.fillStyle = 'black';
    drawContext.fillRect(i * barWidth, offset, 1, 1);
  }
};

/**
 * A request animation frame shortcut. This one is intended to work even in
 * background pages of an extension.
 */
SonicServer.prototype.raf_ = function(callback) {
  setTimeout(callback, 1000/this.fps);
  // var isCrx = !!(window.chrome && chrome.extension);
  // if (isCrx) {
  //   setTimeout(callback, 1000/60);
  // } else {
  //   requestAnimationFrame(callback);
  // }
};

SonicServer.prototype.restartServerIfSanityCheckFails = function() {
  // Strange state 1: peaks gradually get quieter and quieter until they
  // stabilize around -800.
  if (this.freqs[0] < -300) {
    console.error('freqs[0] < -300. Restarting.');
    this.restart();
    return;
  }
  // Strange state 2: all of the peaks are -100. Check just the first few.
  var isValid = true;
  for (var i = 0; i < 10; i++) {
    if (this.freqs[i] == -100) {
      isValid = false;
    }
  }
  if (!isValid) {
    console.error('freqs[0:10] == -100. Restarting.');
    this.restart();
  }
}

SonicServer.prototype.restart = function() {
  //this.stop();
  //this.start();
  window.location.reload();
};


module.exports = SonicServer;

},{"./ring-buffer.js":1,"./sonic-coder.js":2}],4:[function(require,module,exports){
var SonicCoder = require('./sonic-coder.js');

var audioContext = new window.AudioContext || new webkitAudioContext();

/**
 * Encodes text as audio streams.
 *
 * 1. Receives a string of text.
 * 2. Creates an oscillator.
 * 3. Converts characters into frequencies.
 * 4. Transmits frequencies, waiting in between appropriately.
 */
function SonicSocket(params) {
  params = params || {};
  this.mode = params.mode || 0;
  this.coder = params.coder || new SonicCoder();
  this.charDuration = params.charDuration || 0.2;
  this.coder = params.coder || new SonicCoder(params);
  this.rampDuration = params.rampDuration || 0.001;
  this.amp = params.amp || 1;
  this.gain;
  this.osc;
}

SonicSocket.prototype.isModeFreqBin = function() {
  return this.mode == 1;
}

SonicSocket.prototype.send = function(input, opt_callback) {
  // Surround the word with start and end characters.
  input = this.coder.startChar + input + this.coder.endChar;
  var sepChar = this.coder.sepChar;
  var tmpArray = [];
  // input.split("").forEach(function(s, index) {
  //   tmpArray.push(s);
  //   if (index < input.length -1) {
  //     tmpArray.push(sepChar);
  //   }
  // });
  // input = tmpArray.join("");

  // Use WAAPI to schedule the frequencies.
  var durationLength = 0;
  for (var i = 0; i < input.length; i++) {
    var char = input[i];
    var freq = this.coder.charToFreq(char);

    var bin = 0;
    if (this.isModeFreqBin() && char != sepChar) {
      bin = this.coder.charToBin(char);
    } else {

    }

    console.log("Sending char:" + char + ", freq:" + freq + ", bin: " + bin + ", amp: " + this.amp);
    var duration = (char == sepChar) ? (this.charDuration * 0.5) : (bin == 0 ? this.charDuration : this.charDuration * 2);
    durationLength += duration;
    var time = audioContext.currentTime + durationLength;
    this.scheduleToneAt(freq, time, duration, this.amp);
    // 90°位相をずらした波を重ねる
    // this.scheduleToneAt(freq, time + (1/freq/4), this.charDuration, this.amp);
  }

  // If specified, callback after roughly the amount of time it would have
  // taken to transmit the token.
  if (opt_callback) {
    var totalTime = this.charDuration * input.length;
    setTimeout(opt_callback, totalTime * 1000);
  }
};

SonicSocket.prototype.scheduleToneAt = function(freq, startTime, duration, amp) {
  var gainNode = this.gain || audioContext.createGain();
  // Gain => Merger
  gainNode.gain.value = 0;

  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(amp, startTime + this.rampDuration);
  gainNode.gain.setValueAtTime(amp, startTime + duration - this.rampDuration);
  gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

  gainNode.connect(audioContext.destination);

  var osc = this.osc || audioContext.createOscillator();
  osc.frequency.value = freq;
  // osc.type = "square";
  osc.connect(gainNode);

  osc.start(startTime);
  osc.stop(startTime + duration);
};

module.exports = SonicSocket;

},{"./sonic-coder.js":2}],5:[function(require,module,exports){
var SonicSocket = require('./lib/sonic-socket.js');
var SonicServer = require('./lib/sonic-server.js');
var SonicCoder = require('./lib/sonic-coder.js');

var BITS = '01234567'; // 89abcdef
var params = {
  bits: BITS,
  debug: true,
  timeout: 1000,
  freqMin: 19000,
  freqMax: 20000,
  freqError: 100,
  peakThreshold: -115,
  charDuration: 0.05,
  rampDuration: 0.0005,
  bufferLength: 64,
  fps: 100,
  amp: 1,
  minRunLength: 2,
  fftSize: 2048, // default
  mode: 1, // 0: freq, 1: freq+bin
};

var freqRange = params.freqMax - params.freqMin;
var rangeHz = freqRange / Math.ceil((BITS.length + 3) / (params.mode + 1));
var aboutFftSize = 44100 / rangeHz;
var recommendFftSize = Math.pow(2, Math.ceil(Math.log2(aboutFftSize))); // * 2 純粋なものだと厳しいので2倍する
params.fftSize = recommendFftSize;

console.log("Start { freqRange: ", freqRange, ", rangeHz: ", rangeHz, ", aboutFftSize: ", aboutFftSize, ", recommendFftSize: ", recommendFftSize);

// Create an ultranet server.
var sonicServer = new SonicServer(params);
// Create an ultranet socket.
var sonicSocket = new SonicSocket(params);


var history = document.querySelector('#history');
var wrap = document.querySelector('#history-wrap');
var form = document.querySelector('form');
var input = document.querySelector('input');

function init() {
  sonicServer.start();
  sonicServer.on('message', onIncomingChat);
  form.addEventListener('submit', onSubmitForm);
}

function onSubmitForm(e) {
  // Get contents of input element.
  var message = input.value;
  // Send via oscillator.
  sonicSocket.send(message);
  // Clear the input element.
  input.value = '';
  // Don't actually submit the form.
  e.preventDefault();
}

function onIncomingChat(message) {
  console.log('chat inbound. message:' + message);
  history.innerHTML += time() + ': ' + message + '<br/>';
  // Scroll history to the bottom.
  wrap.scrollTop = history.scrollHeight;
}

function time() {
  var now = new Date();
  var hours = now.getHours();
  hours = (hours > 9 ? hours: ' ' + hours);
  var mins = now.getMinutes();
  mins = (mins > 9 ? mins : '0' + mins);
  var secs = now.getSeconds();
  secs = (secs > 9 ? secs : '0' + secs);
  return '[' + hours + ':' + mins + ':' + secs + ']';
}

window.addEventListener('load', init);

},{"./lib/sonic-coder.js":2,"./lib/sonic-server.js":3,"./lib/sonic-socket.js":4}]},{},[5]);
