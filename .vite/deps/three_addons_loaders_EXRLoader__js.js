import {
  unzlibSync
} from "./chunk-EHRWVRIJ.js";
import {
  DataTextureLoader,
  DataUtils,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
  RGFormat,
  RedFormat
} from "./chunk-36FFVN7D.js";
import "./chunk-EQCVQC35.js";

// node_modules/three/examples/jsm/loaders/EXRLoader.js
var EXRLoader = class extends DataTextureLoader {
  /**
   * Constructs a new EXR loader.
   *
   * @param {LoadingManager} [manager] - The loading manager.
   */
  constructor(manager) {
    super(manager);
    this.type = HalfFloatType;
    this.outputFormat = RGBAFormat;
    this.part = 0;
  }
  /**
   * Parses the given EXR texture data.
   *
   * @param {ArrayBuffer} buffer - The raw texture data.
   * @return {DataTextureLoader~TexData} An object representing the parsed texture data.
   */
  parse(buffer) {
    const USHORT_RANGE = 1 << 16;
    const BITMAP_SIZE = USHORT_RANGE >> 3;
    const HUF_ENCBITS = 16;
    const HUF_DECBITS = 14;
    const HUF_ENCSIZE = (1 << HUF_ENCBITS) + 1;
    const HUF_DECSIZE = 1 << HUF_DECBITS;
    const HUF_DECMASK = HUF_DECSIZE - 1;
    const NBITS = 16;
    const A_OFFSET = 1 << NBITS - 1;
    const MOD_MASK = (1 << NBITS) - 1;
    const SHORT_ZEROCODE_RUN = 59;
    const LONG_ZEROCODE_RUN = 63;
    const SHORTEST_LONG_RUN = 2 + LONG_ZEROCODE_RUN - SHORT_ZEROCODE_RUN;
    const ULONG_SIZE = 8;
    const FLOAT32_SIZE = 4;
    const INT32_SIZE = 4;
    const INT16_SIZE = 2;
    const INT8_SIZE = 1;
    const STATIC_HUFFMAN = 0;
    const DEFLATE = 1;
    const UNKNOWN = 0;
    const LOSSY_DCT = 1;
    const RLE = 2;
    const logBase = Math.pow(2.7182818, 2.2);
    let b44LogTable = null;
    function reverseLutFromBitmap(bitmap, lut) {
      let k = 0;
      for (let i = 0; i < USHORT_RANGE; ++i) {
        if (i == 0 || bitmap[i >> 3] & 1 << (i & 7)) {
          lut[k++] = i;
        }
      }
      const n = k - 1;
      while (k < USHORT_RANGE) lut[k++] = 0;
      return n;
    }
    function hufClearDecTable(hdec) {
      for (let i = 0; i < HUF_DECSIZE; i++) {
        hdec[i] = {};
        hdec[i].len = 0;
        hdec[i].lit = 0;
        hdec[i].p = null;
      }
    }
    const getBitsReturn = { l: 0, c: 0, lc: 0 };
    function getBits(nBits, c, lc, uInt8Array2, inOffset) {
      while (lc < nBits) {
        c = c << 8 | parseUint8Array(uInt8Array2, inOffset);
        lc += 8;
      }
      lc -= nBits;
      getBitsReturn.l = c >> lc & (1 << nBits) - 1;
      getBitsReturn.c = c;
      getBitsReturn.lc = lc;
    }
    const hufTableBuffer = new Array(59);
    function hufCanonicalCodeTable(hcode) {
      for (let i = 0; i <= 58; ++i) hufTableBuffer[i] = 0;
      for (let i = 0; i < HUF_ENCSIZE; ++i) hufTableBuffer[hcode[i]] += 1;
      let c = 0;
      for (let i = 58; i > 0; --i) {
        const nc = c + hufTableBuffer[i] >> 1;
        hufTableBuffer[i] = c;
        c = nc;
      }
      for (let i = 0; i < HUF_ENCSIZE; ++i) {
        const l = hcode[i];
        if (l > 0) hcode[i] = l | hufTableBuffer[l]++ << 6;
      }
    }
    function hufUnpackEncTable(uInt8Array2, inOffset, ni, im, iM, hcode) {
      const p = inOffset;
      let c = 0;
      let lc = 0;
      for (; im <= iM; im++) {
        if (p.value - inOffset.value > ni) return false;
        getBits(6, c, lc, uInt8Array2, p);
        const l = getBitsReturn.l;
        c = getBitsReturn.c;
        lc = getBitsReturn.lc;
        hcode[im] = l;
        if (l == LONG_ZEROCODE_RUN) {
          if (p.value - inOffset.value > ni) {
            throw new Error("Something wrong with hufUnpackEncTable");
          }
          getBits(8, c, lc, uInt8Array2, p);
          let zerun = getBitsReturn.l + SHORTEST_LONG_RUN;
          c = getBitsReturn.c;
          lc = getBitsReturn.lc;
          if (im + zerun > iM + 1) {
            throw new Error("Something wrong with hufUnpackEncTable");
          }
          while (zerun--) hcode[im++] = 0;
          im--;
        } else if (l >= SHORT_ZEROCODE_RUN) {
          let zerun = l - SHORT_ZEROCODE_RUN + 2;
          if (im + zerun > iM + 1) {
            throw new Error("Something wrong with hufUnpackEncTable");
          }
          while (zerun--) hcode[im++] = 0;
          im--;
        }
      }
      hufCanonicalCodeTable(hcode);
    }
    function hufLength(code) {
      return code & 63;
    }
    function hufCode(code) {
      return code >> 6;
    }
    function hufBuildDecTable(hcode, im, iM, hdecod) {
      for (; im <= iM; im++) {
        const c = hufCode(hcode[im]);
        const l = hufLength(hcode[im]);
        if (c >> l) {
          throw new Error("Invalid table entry");
        }
        if (l > HUF_DECBITS) {
          const pl = hdecod[c >> l - HUF_DECBITS];
          if (pl.len) {
            throw new Error("Invalid table entry");
          }
          pl.lit++;
          if (pl.p) {
            const p = pl.p;
            pl.p = new Array(pl.lit);
            for (let i = 0; i < pl.lit - 1; ++i) {
              pl.p[i] = p[i];
            }
          } else {
            pl.p = new Array(1);
          }
          pl.p[pl.lit - 1] = im;
        } else if (l) {
          let plOffset = 0;
          for (let i = 1 << HUF_DECBITS - l; i > 0; i--) {
            const pl = hdecod[(c << HUF_DECBITS - l) + plOffset];
            if (pl.len || pl.p) {
              throw new Error("Invalid table entry");
            }
            pl.len = l;
            pl.lit = im;
            plOffset++;
          }
        }
      }
      return true;
    }
    const getCharReturn = { c: 0, lc: 0 };
    function getChar(c, lc, uInt8Array2, inOffset) {
      c = c << 8 | parseUint8Array(uInt8Array2, inOffset);
      lc += 8;
      getCharReturn.c = c;
      getCharReturn.lc = lc;
    }
    const getCodeReturn = { c: 0, lc: 0 };
    function getCode(po, rlc, c, lc, uInt8Array2, inOffset, outBuffer, outBufferOffset, outBufferEndOffset) {
      if (po == rlc) {
        if (lc < 8) {
          getChar(c, lc, uInt8Array2, inOffset);
          c = getCharReturn.c;
          lc = getCharReturn.lc;
        }
        lc -= 8;
        let cs = c >> lc;
        cs = new Uint8Array([cs])[0];
        if (outBufferOffset.value + cs > outBufferEndOffset) {
          return false;
        }
        const s = outBuffer[outBufferOffset.value - 1];
        while (cs-- > 0) {
          outBuffer[outBufferOffset.value++] = s;
        }
      } else if (outBufferOffset.value < outBufferEndOffset) {
        outBuffer[outBufferOffset.value++] = po;
      } else {
        return false;
      }
      getCodeReturn.c = c;
      getCodeReturn.lc = lc;
    }
    function UInt16(value) {
      return value & 65535;
    }
    function Int16(value) {
      const ref = UInt16(value);
      return ref > 32767 ? ref - 65536 : ref;
    }
    const wdec14Return = { a: 0, b: 0 };
    function wdec14(l, h) {
      const ls = Int16(l);
      const hs = Int16(h);
      const hi = hs;
      const ai = ls + (hi & 1) + (hi >> 1);
      const as = ai;
      const bs = ai - hi;
      wdec14Return.a = as;
      wdec14Return.b = bs;
    }
    function wdec16(l, h) {
      const m = UInt16(l);
      const d = UInt16(h);
      const bb = m - (d >> 1) & MOD_MASK;
      const aa = d + bb - A_OFFSET & MOD_MASK;
      wdec14Return.a = aa;
      wdec14Return.b = bb;
    }
    function wav2Decode(buffer2, j, nx, ox, ny, oy, mx) {
      const w14 = mx < 1 << 14;
      const n = nx > ny ? ny : nx;
      let p = 1;
      let p2;
      let py;
      while (p <= n) p <<= 1;
      p >>= 1;
      p2 = p;
      p >>= 1;
      while (p >= 1) {
        py = 0;
        const ey = py + oy * (ny - p2);
        const oy1 = oy * p;
        const oy2 = oy * p2;
        const ox1 = ox * p;
        const ox2 = ox * p2;
        let i00, i01, i10, i11;
        for (; py <= ey; py += oy2) {
          let px = py;
          const ex = py + ox * (nx - p2);
          for (; px <= ex; px += ox2) {
            const p01 = px + ox1;
            const p10 = px + oy1;
            const p11 = p10 + ox1;
            if (w14) {
              wdec14(buffer2[px + j], buffer2[p10 + j]);
              i00 = wdec14Return.a;
              i10 = wdec14Return.b;
              wdec14(buffer2[p01 + j], buffer2[p11 + j]);
              i01 = wdec14Return.a;
              i11 = wdec14Return.b;
              wdec14(i00, i01);
              buffer2[px + j] = wdec14Return.a;
              buffer2[p01 + j] = wdec14Return.b;
              wdec14(i10, i11);
              buffer2[p10 + j] = wdec14Return.a;
              buffer2[p11 + j] = wdec14Return.b;
            } else {
              wdec16(buffer2[px + j], buffer2[p10 + j]);
              i00 = wdec14Return.a;
              i10 = wdec14Return.b;
              wdec16(buffer2[p01 + j], buffer2[p11 + j]);
              i01 = wdec14Return.a;
              i11 = wdec14Return.b;
              wdec16(i00, i01);
              buffer2[px + j] = wdec14Return.a;
              buffer2[p01 + j] = wdec14Return.b;
              wdec16(i10, i11);
              buffer2[p10 + j] = wdec14Return.a;
              buffer2[p11 + j] = wdec14Return.b;
            }
          }
          if (nx & p) {
            const p10 = px + oy1;
            if (w14)
              wdec14(buffer2[px + j], buffer2[p10 + j]);
            else
              wdec16(buffer2[px + j], buffer2[p10 + j]);
            i00 = wdec14Return.a;
            buffer2[p10 + j] = wdec14Return.b;
            buffer2[px + j] = i00;
          }
        }
        if (ny & p) {
          let px = py;
          const ex = py + ox * (nx - p2);
          for (; px <= ex; px += ox2) {
            const p01 = px + ox1;
            if (w14)
              wdec14(buffer2[px + j], buffer2[p01 + j]);
            else
              wdec16(buffer2[px + j], buffer2[p01 + j]);
            i00 = wdec14Return.a;
            buffer2[p01 + j] = wdec14Return.b;
            buffer2[px + j] = i00;
          }
        }
        p2 = p;
        p >>= 1;
      }
      return py;
    }
    function hufDecode(encodingTable, decodingTable, uInt8Array2, inOffset, ni, rlc, no, outBuffer, outOffset) {
      let c = 0;
      let lc = 0;
      const outBufferEndOffset = no;
      const inOffsetEnd = Math.trunc(inOffset.value + (ni + 7) / 8);
      while (inOffset.value < inOffsetEnd) {
        getChar(c, lc, uInt8Array2, inOffset);
        c = getCharReturn.c;
        lc = getCharReturn.lc;
        while (lc >= HUF_DECBITS) {
          const index = c >> lc - HUF_DECBITS & HUF_DECMASK;
          const pl = decodingTable[index];
          if (pl.len) {
            lc -= pl.len;
            getCode(pl.lit, rlc, c, lc, uInt8Array2, inOffset, outBuffer, outOffset, outBufferEndOffset);
            c = getCodeReturn.c;
            lc = getCodeReturn.lc;
          } else {
            if (!pl.p) {
              throw new Error("hufDecode issues");
            }
            let j;
            for (j = 0; j < pl.lit; j++) {
              const l = hufLength(encodingTable[pl.p[j]]);
              while (lc < l && inOffset.value < inOffsetEnd) {
                getChar(c, lc, uInt8Array2, inOffset);
                c = getCharReturn.c;
                lc = getCharReturn.lc;
              }
              if (lc >= l) {
                if (hufCode(encodingTable[pl.p[j]]) == (c >> lc - l & (1 << l) - 1)) {
                  lc -= l;
                  getCode(pl.p[j], rlc, c, lc, uInt8Array2, inOffset, outBuffer, outOffset, outBufferEndOffset);
                  c = getCodeReturn.c;
                  lc = getCodeReturn.lc;
                  break;
                }
              }
            }
            if (j == pl.lit) {
              throw new Error("hufDecode issues");
            }
          }
        }
      }
      const i = 8 - ni & 7;
      c >>= i;
      lc -= i;
      while (lc > 0) {
        const pl = decodingTable[c << HUF_DECBITS - lc & HUF_DECMASK];
        if (pl.len) {
          lc -= pl.len;
          getCode(pl.lit, rlc, c, lc, uInt8Array2, inOffset, outBuffer, outOffset, outBufferEndOffset);
          c = getCodeReturn.c;
          lc = getCodeReturn.lc;
        } else {
          throw new Error("hufDecode issues");
        }
      }
      return true;
    }
    function hufUncompress(uInt8Array2, inDataView, inOffset, nCompressed, outBuffer, nRaw) {
      const outOffset = { value: 0 };
      const initialInOffset = inOffset.value;
      const im = parseUint32(inDataView, inOffset);
      const iM = parseUint32(inDataView, inOffset);
      inOffset.value += 4;
      const nBits = parseUint32(inDataView, inOffset);
      inOffset.value += 4;
      if (im < 0 || im >= HUF_ENCSIZE || iM < 0 || iM >= HUF_ENCSIZE) {
        throw new Error("Something wrong with HUF_ENCSIZE");
      }
      const freq = new Array(HUF_ENCSIZE);
      const hdec = new Array(HUF_DECSIZE);
      hufClearDecTable(hdec);
      const ni = nCompressed - (inOffset.value - initialInOffset);
      hufUnpackEncTable(uInt8Array2, inOffset, ni, im, iM, freq);
      if (nBits > 8 * (nCompressed - (inOffset.value - initialInOffset))) {
        throw new Error("Something wrong with hufUncompress");
      }
      hufBuildDecTable(freq, im, iM, hdec);
      hufDecode(freq, hdec, uInt8Array2, inOffset, nBits, iM, nRaw, outBuffer, outOffset);
    }
    function applyLut(lut, data, nData) {
      for (let i = 0; i < nData; ++i) {
        data[i] = lut[data[i]];
      }
    }
    function predictor(source) {
      for (let t = 1; t < source.length; t++) {
        const d = source[t - 1] + source[t] - 128;
        source[t] = d;
      }
    }
    function interleaveScalar(source, out) {
      let t1 = 0;
      let t2 = Math.floor((source.length + 1) / 2);
      let s = 0;
      const stop = source.length - 1;
      while (true) {
        if (s > stop) break;
        out[s++] = source[t1++];
        if (s > stop) break;
        out[s++] = source[t2++];
      }
    }
    function decodeRunLength(source) {
      let size = source.byteLength;
      const out = new Array();
      let p = 0;
      const reader = new DataView(source);
      while (size > 0) {
        const l = reader.getInt8(p++);
        if (l < 0) {
          const count = -l;
          size -= count + 1;
          for (let i = 0; i < count; i++) {
            out.push(reader.getUint8(p++));
          }
        } else {
          const count = l;
          size -= 2;
          const value = reader.getUint8(p++);
          for (let i = 0; i < count + 1; i++) {
            out.push(value);
          }
        }
      }
      return out;
    }
    function lossyDctDecode(cscSet, rowPtrs, channelData, acBuffer, dcBuffer, outBuffer) {
      let dataView = new DataView(outBuffer.buffer);
      const width = channelData[cscSet.idx[0]].width;
      const height = channelData[cscSet.idx[0]].height;
      const numComp = 3;
      const numFullBlocksX = Math.floor(width / 8);
      const numBlocksX = Math.ceil(width / 8);
      const numBlocksY = Math.ceil(height / 8);
      const leftoverX = width - (numBlocksX - 1) * 8;
      const leftoverY = height - (numBlocksY - 1) * 8;
      const currAcComp = { value: 0 };
      const currDcComp = new Array(numComp);
      const dctData = new Array(numComp);
      const halfZigBlock = new Array(numComp);
      const rowBlock = new Array(numComp);
      const rowOffsets = new Array(numComp);
      for (let comp = 0; comp < numComp; ++comp) {
        rowOffsets[comp] = rowPtrs[cscSet.idx[comp]];
        currDcComp[comp] = comp < 1 ? 0 : currDcComp[comp - 1] + numBlocksX * numBlocksY;
        dctData[comp] = new Float32Array(64);
        halfZigBlock[comp] = new Uint16Array(64);
        rowBlock[comp] = new Uint16Array(numBlocksX * 64);
      }
      for (let blocky = 0; blocky < numBlocksY; ++blocky) {
        let maxY = 8;
        if (blocky == numBlocksY - 1)
          maxY = leftoverY;
        let maxX = 8;
        for (let blockx = 0; blockx < numBlocksX; ++blockx) {
          if (blockx == numBlocksX - 1)
            maxX = leftoverX;
          for (let comp = 0; comp < numComp; ++comp) {
            halfZigBlock[comp].fill(0);
            halfZigBlock[comp][0] = dcBuffer[currDcComp[comp]++];
            unRleAC(currAcComp, acBuffer, halfZigBlock[comp]);
            unZigZag(halfZigBlock[comp], dctData[comp]);
            dctInverse(dctData[comp]);
          }
          if (numComp == 3) {
            csc709Inverse(dctData);
          }
          for (let comp = 0; comp < numComp; ++comp) {
            convertToHalf(dctData[comp], rowBlock[comp], blockx * 64);
          }
        }
        let offset2 = 0;
        for (let comp = 0; comp < numComp; ++comp) {
          const type = channelData[cscSet.idx[comp]].type;
          for (let y = 8 * blocky; y < 8 * blocky + maxY; ++y) {
            offset2 = rowOffsets[comp][y];
            for (let blockx = 0; blockx < numFullBlocksX; ++blockx) {
              const src = blockx * 64 + (y & 7) * 8;
              dataView.setUint16(offset2 + 0 * INT16_SIZE * type, rowBlock[comp][src + 0], true);
              dataView.setUint16(offset2 + 1 * INT16_SIZE * type, rowBlock[comp][src + 1], true);
              dataView.setUint16(offset2 + 2 * INT16_SIZE * type, rowBlock[comp][src + 2], true);
              dataView.setUint16(offset2 + 3 * INT16_SIZE * type, rowBlock[comp][src + 3], true);
              dataView.setUint16(offset2 + 4 * INT16_SIZE * type, rowBlock[comp][src + 4], true);
              dataView.setUint16(offset2 + 5 * INT16_SIZE * type, rowBlock[comp][src + 5], true);
              dataView.setUint16(offset2 + 6 * INT16_SIZE * type, rowBlock[comp][src + 6], true);
              dataView.setUint16(offset2 + 7 * INT16_SIZE * type, rowBlock[comp][src + 7], true);
              offset2 += 8 * INT16_SIZE * type;
            }
          }
          if (numFullBlocksX != numBlocksX) {
            for (let y = 8 * blocky; y < 8 * blocky + maxY; ++y) {
              const offset3 = rowOffsets[comp][y] + 8 * numFullBlocksX * INT16_SIZE * type;
              const src = numFullBlocksX * 64 + (y & 7) * 8;
              for (let x = 0; x < maxX; ++x) {
                dataView.setUint16(offset3 + x * INT16_SIZE * type, rowBlock[comp][src + x], true);
              }
            }
          }
        }
      }
      const halfRow = new Uint16Array(width);
      dataView = new DataView(outBuffer.buffer);
      for (let comp = 0; comp < numComp; ++comp) {
        channelData[cscSet.idx[comp]].decoded = true;
        const type = channelData[cscSet.idx[comp]].type;
        if (channelData[comp].type != 2) continue;
        for (let y = 0; y < height; ++y) {
          const offset2 = rowOffsets[comp][y];
          for (let x = 0; x < width; ++x) {
            halfRow[x] = dataView.getUint16(offset2 + x * INT16_SIZE * type, true);
          }
          for (let x = 0; x < width; ++x) {
            dataView.setFloat32(offset2 + x * INT16_SIZE * type, decodeFloat16(halfRow[x]), true);
          }
        }
      }
    }
    function lossyDctChannelDecode(channelIndex, rowPtrs, channelData, acBuffer, dcBuffer, outBuffer) {
      const dataView = new DataView(outBuffer.buffer);
      const cd = channelData[channelIndex];
      const width = cd.width;
      const height = cd.height;
      const numBlocksX = Math.ceil(width / 8);
      const numBlocksY = Math.ceil(height / 8);
      const numFullBlocksX = Math.floor(width / 8);
      const leftoverX = width - (numBlocksX - 1) * 8;
      const leftoverY = height - (numBlocksY - 1) * 8;
      const currAcComp = { value: 0 };
      let currDcComp = 0;
      const dctData = new Float32Array(64);
      const halfZigBlock = new Uint16Array(64);
      const rowBlock = new Uint16Array(numBlocksX * 64);
      for (let blocky = 0; blocky < numBlocksY; ++blocky) {
        let maxY = 8;
        if (blocky == numBlocksY - 1) maxY = leftoverY;
        for (let blockx = 0; blockx < numBlocksX; ++blockx) {
          halfZigBlock.fill(0);
          halfZigBlock[0] = dcBuffer[currDcComp++];
          unRleAC(currAcComp, acBuffer, halfZigBlock);
          unZigZag(halfZigBlock, dctData);
          dctInverse(dctData);
          convertToHalf(dctData, rowBlock, blockx * 64);
        }
        for (let y = 8 * blocky; y < 8 * blocky + maxY; ++y) {
          let offset2 = rowPtrs[channelIndex][y];
          for (let blockx = 0; blockx < numFullBlocksX; ++blockx) {
            const src = blockx * 64 + (y & 7) * 8;
            for (let x = 0; x < 8; ++x) {
              dataView.setUint16(offset2 + x * INT16_SIZE * cd.type, rowBlock[src + x], true);
            }
            offset2 += 8 * INT16_SIZE * cd.type;
          }
          if (numBlocksX != numFullBlocksX) {
            const src = numFullBlocksX * 64 + (y & 7) * 8;
            for (let x = 0; x < leftoverX; ++x) {
              dataView.setUint16(offset2 + x * INT16_SIZE * cd.type, rowBlock[src + x], true);
            }
          }
        }
      }
      cd.decoded = true;
    }
    function unRleAC(currAcComp, acBuffer, halfZigBlock) {
      let acValue;
      let dctComp = 1;
      while (dctComp < 64) {
        acValue = acBuffer[currAcComp.value];
        if (acValue == 65280) {
          dctComp = 64;
        } else if (acValue >> 8 == 255) {
          dctComp += acValue & 255;
        } else {
          halfZigBlock[dctComp] = acValue;
          dctComp++;
        }
        currAcComp.value++;
      }
    }
    function unZigZag(src, dst) {
      dst[0] = decodeFloat16(src[0]);
      dst[1] = decodeFloat16(src[1]);
      dst[2] = decodeFloat16(src[5]);
      dst[3] = decodeFloat16(src[6]);
      dst[4] = decodeFloat16(src[14]);
      dst[5] = decodeFloat16(src[15]);
      dst[6] = decodeFloat16(src[27]);
      dst[7] = decodeFloat16(src[28]);
      dst[8] = decodeFloat16(src[2]);
      dst[9] = decodeFloat16(src[4]);
      dst[10] = decodeFloat16(src[7]);
      dst[11] = decodeFloat16(src[13]);
      dst[12] = decodeFloat16(src[16]);
      dst[13] = decodeFloat16(src[26]);
      dst[14] = decodeFloat16(src[29]);
      dst[15] = decodeFloat16(src[42]);
      dst[16] = decodeFloat16(src[3]);
      dst[17] = decodeFloat16(src[8]);
      dst[18] = decodeFloat16(src[12]);
      dst[19] = decodeFloat16(src[17]);
      dst[20] = decodeFloat16(src[25]);
      dst[21] = decodeFloat16(src[30]);
      dst[22] = decodeFloat16(src[41]);
      dst[23] = decodeFloat16(src[43]);
      dst[24] = decodeFloat16(src[9]);
      dst[25] = decodeFloat16(src[11]);
      dst[26] = decodeFloat16(src[18]);
      dst[27] = decodeFloat16(src[24]);
      dst[28] = decodeFloat16(src[31]);
      dst[29] = decodeFloat16(src[40]);
      dst[30] = decodeFloat16(src[44]);
      dst[31] = decodeFloat16(src[53]);
      dst[32] = decodeFloat16(src[10]);
      dst[33] = decodeFloat16(src[19]);
      dst[34] = decodeFloat16(src[23]);
      dst[35] = decodeFloat16(src[32]);
      dst[36] = decodeFloat16(src[39]);
      dst[37] = decodeFloat16(src[45]);
      dst[38] = decodeFloat16(src[52]);
      dst[39] = decodeFloat16(src[54]);
      dst[40] = decodeFloat16(src[20]);
      dst[41] = decodeFloat16(src[22]);
      dst[42] = decodeFloat16(src[33]);
      dst[43] = decodeFloat16(src[38]);
      dst[44] = decodeFloat16(src[46]);
      dst[45] = decodeFloat16(src[51]);
      dst[46] = decodeFloat16(src[55]);
      dst[47] = decodeFloat16(src[60]);
      dst[48] = decodeFloat16(src[21]);
      dst[49] = decodeFloat16(src[34]);
      dst[50] = decodeFloat16(src[37]);
      dst[51] = decodeFloat16(src[47]);
      dst[52] = decodeFloat16(src[50]);
      dst[53] = decodeFloat16(src[56]);
      dst[54] = decodeFloat16(src[59]);
      dst[55] = decodeFloat16(src[61]);
      dst[56] = decodeFloat16(src[35]);
      dst[57] = decodeFloat16(src[36]);
      dst[58] = decodeFloat16(src[48]);
      dst[59] = decodeFloat16(src[49]);
      dst[60] = decodeFloat16(src[57]);
      dst[61] = decodeFloat16(src[58]);
      dst[62] = decodeFloat16(src[62]);
      dst[63] = decodeFloat16(src[63]);
    }
    function dctInverse(data) {
      const a = 0.5 * Math.cos(3.14159 / 4);
      const b = 0.5 * Math.cos(3.14159 / 16);
      const c = 0.5 * Math.cos(3.14159 / 8);
      const d = 0.5 * Math.cos(3 * 3.14159 / 16);
      const e = 0.5 * Math.cos(5 * 3.14159 / 16);
      const f = 0.5 * Math.cos(3 * 3.14159 / 8);
      const g = 0.5 * Math.cos(7 * 3.14159 / 16);
      const alpha = new Array(4);
      const beta = new Array(4);
      const theta = new Array(4);
      const gamma = new Array(4);
      for (let row = 0; row < 8; ++row) {
        const rowPtr = row * 8;
        alpha[0] = c * data[rowPtr + 2];
        alpha[1] = f * data[rowPtr + 2];
        alpha[2] = c * data[rowPtr + 6];
        alpha[3] = f * data[rowPtr + 6];
        beta[0] = b * data[rowPtr + 1] + d * data[rowPtr + 3] + e * data[rowPtr + 5] + g * data[rowPtr + 7];
        beta[1] = d * data[rowPtr + 1] - g * data[rowPtr + 3] - b * data[rowPtr + 5] - e * data[rowPtr + 7];
        beta[2] = e * data[rowPtr + 1] - b * data[rowPtr + 3] + g * data[rowPtr + 5] + d * data[rowPtr + 7];
        beta[3] = g * data[rowPtr + 1] - e * data[rowPtr + 3] + d * data[rowPtr + 5] - b * data[rowPtr + 7];
        theta[0] = a * (data[rowPtr + 0] + data[rowPtr + 4]);
        theta[3] = a * (data[rowPtr + 0] - data[rowPtr + 4]);
        theta[1] = alpha[0] + alpha[3];
        theta[2] = alpha[1] - alpha[2];
        gamma[0] = theta[0] + theta[1];
        gamma[1] = theta[3] + theta[2];
        gamma[2] = theta[3] - theta[2];
        gamma[3] = theta[0] - theta[1];
        data[rowPtr + 0] = gamma[0] + beta[0];
        data[rowPtr + 1] = gamma[1] + beta[1];
        data[rowPtr + 2] = gamma[2] + beta[2];
        data[rowPtr + 3] = gamma[3] + beta[3];
        data[rowPtr + 4] = gamma[3] - beta[3];
        data[rowPtr + 5] = gamma[2] - beta[2];
        data[rowPtr + 6] = gamma[1] - beta[1];
        data[rowPtr + 7] = gamma[0] - beta[0];
      }
      for (let column = 0; column < 8; ++column) {
        alpha[0] = c * data[16 + column];
        alpha[1] = f * data[16 + column];
        alpha[2] = c * data[48 + column];
        alpha[3] = f * data[48 + column];
        beta[0] = b * data[8 + column] + d * data[24 + column] + e * data[40 + column] + g * data[56 + column];
        beta[1] = d * data[8 + column] - g * data[24 + column] - b * data[40 + column] - e * data[56 + column];
        beta[2] = e * data[8 + column] - b * data[24 + column] + g * data[40 + column] + d * data[56 + column];
        beta[3] = g * data[8 + column] - e * data[24 + column] + d * data[40 + column] - b * data[56 + column];
        theta[0] = a * (data[column] + data[32 + column]);
        theta[3] = a * (data[column] - data[32 + column]);
        theta[1] = alpha[0] + alpha[3];
        theta[2] = alpha[1] - alpha[2];
        gamma[0] = theta[0] + theta[1];
        gamma[1] = theta[3] + theta[2];
        gamma[2] = theta[3] - theta[2];
        gamma[3] = theta[0] - theta[1];
        data[0 + column] = gamma[0] + beta[0];
        data[8 + column] = gamma[1] + beta[1];
        data[16 + column] = gamma[2] + beta[2];
        data[24 + column] = gamma[3] + beta[3];
        data[32 + column] = gamma[3] - beta[3];
        data[40 + column] = gamma[2] - beta[2];
        data[48 + column] = gamma[1] - beta[1];
        data[56 + column] = gamma[0] - beta[0];
      }
    }
    function csc709Inverse(data) {
      for (let i = 0; i < 64; ++i) {
        const y = data[0][i];
        const cb = data[1][i];
        const cr = data[2][i];
        data[0][i] = y + 1.5747 * cr;
        data[1][i] = y - 0.1873 * cb - 0.4682 * cr;
        data[2][i] = y + 1.8556 * cb;
      }
    }
    function convertToHalf(src, dst, idx) {
      for (let i = 0; i < 64; ++i) {
        dst[idx + i] = DataUtils.toHalfFloat(toLinear(src[i]));
      }
    }
    function toLinear(float) {
      if (float <= 1) {
        return Math.sign(float) * Math.pow(Math.abs(float), 2.2);
      } else {
        return Math.sign(float) * Math.pow(logBase, Math.abs(float) - 1);
      }
    }
    function uncompressRAW(info) {
      return new DataView(info.array.buffer, info.offset.value, info.size);
    }
    function uncompressRLE(info) {
      const compressed = info.viewer.buffer.slice(info.offset.value, info.offset.value + info.size);
      const rawBuffer = new Uint8Array(decodeRunLength(compressed));
      const tmpBuffer = new Uint8Array(rawBuffer.length);
      predictor(rawBuffer);
      interleaveScalar(rawBuffer, tmpBuffer);
      return new DataView(tmpBuffer.buffer);
    }
    function uncompressZIP(info) {
      const compressed = info.array.slice(info.offset.value, info.offset.value + info.size);
      const rawBuffer = unzlibSync(compressed);
      const tmpBuffer = new Uint8Array(rawBuffer.length);
      predictor(rawBuffer);
      interleaveScalar(rawBuffer, tmpBuffer);
      return new DataView(tmpBuffer.buffer);
    }
    function uncompressPIZ(info) {
      const inDataView = info.viewer;
      const inOffset = { value: info.offset.value };
      const outBuffer = new Uint16Array(info.columns * info.lines * (info.inputChannels.length * info.type));
      const bitmap = new Uint8Array(BITMAP_SIZE);
      let outBufferEnd = 0;
      const pizChannelData = new Array(info.inputChannels.length);
      for (let i = 0, il = info.inputChannels.length; i < il; i++) {
        pizChannelData[i] = {};
        pizChannelData[i]["start"] = outBufferEnd;
        pizChannelData[i]["end"] = pizChannelData[i]["start"];
        pizChannelData[i]["nx"] = info.columns;
        pizChannelData[i]["ny"] = info.lines;
        pizChannelData[i]["size"] = info.type;
        outBufferEnd += pizChannelData[i].nx * pizChannelData[i].ny * pizChannelData[i].size;
      }
      const minNonZero = parseUint16(inDataView, inOffset);
      const maxNonZero = parseUint16(inDataView, inOffset);
      if (maxNonZero >= BITMAP_SIZE) {
        throw new Error("Something is wrong with PIZ_COMPRESSION BITMAP_SIZE");
      }
      if (minNonZero <= maxNonZero) {
        for (let i = 0; i < maxNonZero - minNonZero + 1; i++) {
          bitmap[i + minNonZero] = parseUint8(inDataView, inOffset);
        }
      }
      const lut = new Uint16Array(USHORT_RANGE);
      const maxValue = reverseLutFromBitmap(bitmap, lut);
      const length = parseUint32(inDataView, inOffset);
      hufUncompress(info.array, inDataView, inOffset, length, outBuffer, outBufferEnd);
      for (let i = 0; i < info.inputChannels.length; ++i) {
        const cd = pizChannelData[i];
        for (let j = 0; j < pizChannelData[i].size; ++j) {
          wav2Decode(
            outBuffer,
            cd.start + j,
            cd.nx,
            cd.size,
            cd.ny,
            cd.nx * cd.size,
            maxValue
          );
        }
      }
      applyLut(lut, outBuffer, outBufferEnd);
      let tmpOffset = 0;
      const tmpBuffer = new Uint8Array(outBuffer.buffer.byteLength);
      for (let y = 0; y < info.lines; y++) {
        for (let c = 0; c < info.inputChannels.length; c++) {
          const cd = pizChannelData[c];
          const n = cd.nx * cd.size;
          const cp = new Uint8Array(outBuffer.buffer, cd.end * INT16_SIZE, n * INT16_SIZE);
          tmpBuffer.set(cp, tmpOffset);
          tmpOffset += n * INT16_SIZE;
          cd.end += n;
        }
      }
      return new DataView(tmpBuffer.buffer);
    }
    function uncompressPXR(info) {
      const compressed = info.array.slice(info.offset.value, info.offset.value + info.size);
      const rawBuffer = unzlibSync(compressed);
      const byteSize = info.inputChannels.length * info.lines * info.columns * info.totalBytes;
      const tmpBuffer = new ArrayBuffer(byteSize);
      const viewer = new DataView(tmpBuffer);
      let tmpBufferEnd = 0;
      let writePtr = 0;
      const ptr = new Array(4);
      for (let y = 0; y < info.lines; y++) {
        for (let c = 0; c < info.inputChannels.length; c++) {
          let pixel = 0;
          const type = info.inputChannels[c].pixelType;
          switch (type) {
            case 1:
              ptr[0] = tmpBufferEnd;
              ptr[1] = ptr[0] + info.columns;
              tmpBufferEnd = ptr[1] + info.columns;
              for (let j = 0; j < info.columns; ++j) {
                const diff = rawBuffer[ptr[0]++] << 8 | rawBuffer[ptr[1]++];
                pixel += diff;
                viewer.setUint16(writePtr, pixel, true);
                writePtr += 2;
              }
              break;
            case 2:
              ptr[0] = tmpBufferEnd;
              ptr[1] = ptr[0] + info.columns;
              ptr[2] = ptr[1] + info.columns;
              tmpBufferEnd = ptr[2] + info.columns;
              for (let j = 0; j < info.columns; ++j) {
                const diff = rawBuffer[ptr[0]++] << 24 | rawBuffer[ptr[1]++] << 16 | rawBuffer[ptr[2]++] << 8;
                pixel += diff;
                viewer.setUint32(writePtr, pixel, true);
                writePtr += 4;
              }
              break;
          }
        }
      }
      return viewer;
    }
    function uncompressB44(info) {
      const src = info.array;
      let srcOffset = info.offset.value;
      const width = info.columns;
      const height = info.lines;
      const channels = info.inputChannels;
      const totalBytes = info.totalBytes;
      const isB44A = EXRHeader.compression === "B44A_COMPRESSION";
      const outBuffer = new Uint8Array(height * width * totalBytes);
      const block = new Uint16Array(16);
      let chByteOffset = 0;
      for (let c = 0; c < channels.length; c++) {
        const channel = channels[c];
        const pixelSize = channel.pixelType * 2;
        const chanWidth = Math.ceil(width / channel.xSampling);
        const chanHeight = Math.ceil(height / channel.ySampling);
        const isFullRes = channel.xSampling === 1 && channel.ySampling === 1;
        if (channel.pixelType !== 1) {
          for (let y = 0; y < chanHeight; y++) {
            if (isFullRes) {
              const lineBase = y * width * totalBytes + chByteOffset * width;
              for (let x = 0; x < chanWidth * pixelSize; x++) {
                outBuffer[lineBase + x] = src[srcOffset++];
              }
            } else {
              srcOffset += chanWidth * pixelSize;
            }
          }
          chByteOffset += pixelSize;
          continue;
        }
        const numBlocksX = Math.ceil(chanWidth / 4);
        const numBlocksY = Math.ceil(chanHeight / 4);
        for (let by = 0; by < numBlocksY; by++) {
          for (let bx = 0; bx < numBlocksX; bx++) {
            if (isB44A && src[srcOffset + 2] >= 52) {
              const t = src[srcOffset] << 8 | src[srcOffset + 1];
              const h = t & 32768 ? t & 32767 : ~t & 65535;
              block.fill(h);
              srcOffset += 3;
            } else {
              const s0 = src[srcOffset] << 8 | src[srcOffset + 1];
              const shift = src[srcOffset + 2] >> 2;
              const bias = 32 << shift;
              const s4 = s0 + ((src[srcOffset + 2] << 4 | src[srcOffset + 3] >> 4) & 63) * (1 << shift) - bias & 65535;
              const s8 = s4 + ((src[srcOffset + 3] << 2 | src[srcOffset + 4] >> 6) & 63) * (1 << shift) - bias & 65535;
              const s12 = s8 + (src[srcOffset + 4] & 63) * (1 << shift) - bias & 65535;
              const s1 = s0 + (src[srcOffset + 5] >> 2 & 63) * (1 << shift) - bias & 65535;
              const s5 = s4 + ((src[srcOffset + 5] << 4 | src[srcOffset + 6] >> 4) & 63) * (1 << shift) - bias & 65535;
              const s9 = s8 + ((src[srcOffset + 6] << 2 | src[srcOffset + 7] >> 6) & 63) * (1 << shift) - bias & 65535;
              const s13 = s12 + (src[srcOffset + 7] & 63) * (1 << shift) - bias & 65535;
              const s2 = s1 + (src[srcOffset + 8] >> 2 & 63) * (1 << shift) - bias & 65535;
              const s6 = s5 + ((src[srcOffset + 8] << 4 | src[srcOffset + 9] >> 4) & 63) * (1 << shift) - bias & 65535;
              const s10 = s9 + ((src[srcOffset + 9] << 2 | src[srcOffset + 10] >> 6) & 63) * (1 << shift) - bias & 65535;
              const s14 = s13 + (src[srcOffset + 10] & 63) * (1 << shift) - bias & 65535;
              const s3 = s2 + (src[srcOffset + 11] >> 2 & 63) * (1 << shift) - bias & 65535;
              const s7 = s6 + ((src[srcOffset + 11] << 4 | src[srcOffset + 12] >> 4) & 63) * (1 << shift) - bias & 65535;
              const s11 = s10 + ((src[srcOffset + 12] << 2 | src[srcOffset + 13] >> 6) & 63) * (1 << shift) - bias & 65535;
              const s15 = s14 + (src[srcOffset + 13] & 63) * (1 << shift) - bias & 65535;
              const t = [s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15];
              for (let i = 0; i < 16; i++) {
                block[i] = t[i] & 32768 ? t[i] & 32767 : ~t[i] & 65535;
              }
              srcOffset += 14;
            }
            if (channel.pLinear) {
              if (b44LogTable === null) {
                b44LogTable = new Uint16Array(65536);
                for (let i = 0; i < 65536; i++) {
                  if ((i & 31744) === 31744 || i > 32768) {
                    b44LogTable[i] = 0;
                  } else {
                    const f = decodeFloat16(i);
                    b44LogTable[i] = f <= 0 ? 0 : DataUtils.toHalfFloat(8 * Math.log(f));
                  }
                }
              }
              for (let i = 0; i < 16; i++) block[i] = b44LogTable[block[i]];
            }
            for (let py = 0; py < 4; py++) {
              const chanY = by * 4 + py;
              if (chanY >= chanHeight) continue;
              for (let px = 0; px < 4; px++) {
                const chanX = bx * 4 + px;
                if (chanX >= chanWidth) continue;
                const val = block[py * 4 + px];
                for (let dy = 0; dy < channel.ySampling; dy++) {
                  const fullY = chanY * channel.ySampling + dy;
                  if (fullY >= height) continue;
                  for (let dx = 0; dx < channel.xSampling; dx++) {
                    const fullX = chanX * channel.xSampling + dx;
                    if (fullX >= width) continue;
                    const outIdx = fullY * width * totalBytes + chByteOffset * width + fullX * 2;
                    outBuffer[outIdx] = val & 255;
                    outBuffer[outIdx + 1] = val >> 8 & 255;
                  }
                }
              }
            }
          }
        }
        chByteOffset += 2;
      }
      return new DataView(outBuffer.buffer);
    }
    function uncompressDWA(info) {
      const inDataView = info.viewer;
      const inOffset = { value: info.offset.value };
      const outBuffer = new Uint8Array(info.columns * info.lines * (info.inputChannels.length * info.type * INT16_SIZE));
      const dwaHeader = {
        version: parseInt64(inDataView, inOffset),
        unknownUncompressedSize: parseInt64(inDataView, inOffset),
        unknownCompressedSize: parseInt64(inDataView, inOffset),
        acCompressedSize: parseInt64(inDataView, inOffset),
        dcCompressedSize: parseInt64(inDataView, inOffset),
        rleCompressedSize: parseInt64(inDataView, inOffset),
        rleUncompressedSize: parseInt64(inDataView, inOffset),
        rleRawSize: parseInt64(inDataView, inOffset),
        totalAcUncompressedCount: parseInt64(inDataView, inOffset),
        totalDcUncompressedCount: parseInt64(inDataView, inOffset),
        acCompression: parseInt64(inDataView, inOffset)
      };
      if (dwaHeader.version < 2)
        throw new Error("EXRLoader.parse: " + EXRHeader.compression + " version " + dwaHeader.version + " is unsupported");
      const channelRules = new Array();
      let ruleSize = parseUint16(inDataView, inOffset) - INT16_SIZE;
      while (ruleSize > 0) {
        const name = parseNullTerminatedString(inDataView.buffer, inOffset);
        const value = parseUint8(inDataView, inOffset);
        const compression = value >> 2 & 3;
        const csc = (value >> 4) - 1;
        const index = new Int8Array([csc])[0];
        const type = parseUint8(inDataView, inOffset);
        channelRules.push({
          name,
          index,
          type,
          compression
        });
        ruleSize -= name.length + 3;
      }
      const channels = EXRHeader.channels;
      const channelData = new Array(info.inputChannels.length);
      for (let i = 0; i < info.inputChannels.length; ++i) {
        const cd = channelData[i] = {};
        const channel = channels[i];
        cd.name = channel.name;
        cd.compression = UNKNOWN;
        cd.decoded = false;
        cd.type = channel.pixelType;
        cd.pLinear = channel.pLinear;
        cd.width = info.columns;
        cd.height = info.lines;
      }
      const cscSet = {
        idx: new Array(3)
      };
      for (let offset2 = 0; offset2 < info.inputChannels.length; ++offset2) {
        const cd = channelData[offset2];
        const dotIndex = cd.name.lastIndexOf(".");
        const suffix = dotIndex >= 0 ? cd.name.substring(dotIndex + 1) : cd.name;
        for (let i = 0; i < channelRules.length; ++i) {
          const rule = channelRules[i];
          if (suffix === rule.name && cd.type === rule.type) {
            cd.compression = rule.compression;
            if (rule.index >= 0) {
              cscSet.idx[rule.index] = offset2;
            }
            cd.offset = offset2;
          }
        }
      }
      let acBuffer, dcBuffer, rleBuffer;
      if (dwaHeader.acCompressedSize > 0) {
        switch (dwaHeader.acCompression) {
          case STATIC_HUFFMAN:
            acBuffer = new Uint16Array(dwaHeader.totalAcUncompressedCount);
            hufUncompress(info.array, inDataView, inOffset, dwaHeader.acCompressedSize, acBuffer, dwaHeader.totalAcUncompressedCount);
            break;
          case DEFLATE:
            const compressed = info.array.slice(inOffset.value, inOffset.value + dwaHeader.totalAcUncompressedCount);
            const data = unzlibSync(compressed);
            acBuffer = new Uint16Array(data.buffer);
            inOffset.value += dwaHeader.totalAcUncompressedCount;
            break;
        }
      }
      if (dwaHeader.dcCompressedSize > 0) {
        const zlibInfo = {
          array: info.array,
          offset: inOffset,
          size: dwaHeader.dcCompressedSize
        };
        dcBuffer = new Uint16Array(uncompressZIP(zlibInfo).buffer);
        inOffset.value += dwaHeader.dcCompressedSize;
      }
      if (dwaHeader.rleRawSize > 0) {
        const compressed = info.array.slice(inOffset.value, inOffset.value + dwaHeader.rleCompressedSize);
        const data = unzlibSync(compressed);
        rleBuffer = decodeRunLength(data.buffer);
        inOffset.value += dwaHeader.rleCompressedSize;
      }
      let outBufferEnd = 0;
      const rowOffsets = new Array(channelData.length);
      for (let i = 0; i < rowOffsets.length; ++i) {
        rowOffsets[i] = new Array();
      }
      for (let y = 0; y < info.lines; ++y) {
        for (let chan = 0; chan < channelData.length; ++chan) {
          rowOffsets[chan].push(outBufferEnd);
          outBufferEnd += channelData[chan].width * info.type * INT16_SIZE;
        }
      }
      if (cscSet.idx[0] !== void 0 && channelData[cscSet.idx[0]]) {
        lossyDctDecode(cscSet, rowOffsets, channelData, acBuffer, dcBuffer, outBuffer);
      }
      for (let i = 0; i < channelData.length; ++i) {
        const cd = channelData[i];
        if (cd.decoded) continue;
        switch (cd.compression) {
          case RLE:
            let row = 0;
            let rleOffset = 0;
            for (let y = 0; y < info.lines; ++y) {
              let rowOffsetBytes = rowOffsets[i][row];
              for (let x = 0; x < cd.width; ++x) {
                for (let byte = 0; byte < INT16_SIZE * cd.type; ++byte) {
                  outBuffer[rowOffsetBytes++] = rleBuffer[rleOffset + byte * cd.width * cd.height];
                }
                rleOffset++;
              }
              row++;
            }
            break;
          case LOSSY_DCT:
            lossyDctChannelDecode(i, rowOffsets, channelData, acBuffer, dcBuffer, outBuffer);
            break;
          default:
            throw new Error("EXRLoader.parse: unsupported channel compression");
        }
      }
      return new DataView(outBuffer.buffer);
    }
    function parseNullTerminatedString(buffer2, offset2) {
      const uintBuffer = new Uint8Array(buffer2);
      let endOffset = 0;
      while (uintBuffer[offset2.value + endOffset] != 0) {
        endOffset += 1;
      }
      const stringValue = new TextDecoder().decode(
        uintBuffer.slice(offset2.value, offset2.value + endOffset)
      );
      offset2.value = offset2.value + endOffset + 1;
      return stringValue;
    }
    function parseFixedLengthString(buffer2, offset2, size) {
      const stringValue = new TextDecoder().decode(
        new Uint8Array(buffer2).slice(offset2.value, offset2.value + size)
      );
      offset2.value = offset2.value + size;
      return stringValue;
    }
    function parseRational(dataView, offset2) {
      const x = parseInt32(dataView, offset2);
      const y = parseUint32(dataView, offset2);
      return [x, y];
    }
    function parseTimecode(dataView, offset2) {
      const x = parseUint32(dataView, offset2);
      const y = parseUint32(dataView, offset2);
      return [x, y];
    }
    function parseInt32(dataView, offset2) {
      const Int32 = dataView.getInt32(offset2.value, true);
      offset2.value = offset2.value + INT32_SIZE;
      return Int32;
    }
    function parseUint32(dataView, offset2) {
      const Uint32 = dataView.getUint32(offset2.value, true);
      offset2.value = offset2.value + INT32_SIZE;
      return Uint32;
    }
    function parseUint8Array(uInt8Array2, offset2) {
      const Uint8 = uInt8Array2[offset2.value];
      offset2.value = offset2.value + INT8_SIZE;
      return Uint8;
    }
    function parseUint8(dataView, offset2) {
      const Uint8 = dataView.getUint8(offset2.value);
      offset2.value = offset2.value + INT8_SIZE;
      return Uint8;
    }
    const parseInt64 = function(dataView, offset2) {
      const int = Number(dataView.getBigInt64(offset2.value, true));
      offset2.value += ULONG_SIZE;
      return int;
    };
    function parseFloat32(dataView, offset2) {
      const float = dataView.getFloat32(offset2.value, true);
      offset2.value += FLOAT32_SIZE;
      return float;
    }
    function decodeFloat32(dataView, offset2) {
      return DataUtils.toHalfFloat(parseFloat32(dataView, offset2));
    }
    function decodeFloat16(binary) {
      const exponent = (binary & 31744) >> 10, fraction = binary & 1023;
      return (binary >> 15 ? -1 : 1) * (exponent ? exponent === 31 ? fraction ? NaN : Infinity : Math.pow(2, exponent - 15) * (1 + fraction / 1024) : 6103515625e-14 * (fraction / 1024));
    }
    function parseUint16(dataView, offset2) {
      const Uint16 = dataView.getUint16(offset2.value, true);
      offset2.value += INT16_SIZE;
      return Uint16;
    }
    function parseFloat16(buffer2, offset2) {
      return decodeFloat16(parseUint16(buffer2, offset2));
    }
    function parseChlist(dataView, buffer2, offset2, size) {
      const startOffset = offset2.value;
      const channels = [];
      while (offset2.value < startOffset + size - 1) {
        const name = parseNullTerminatedString(buffer2, offset2);
        const pixelType = parseInt32(dataView, offset2);
        const pLinear = parseUint8(dataView, offset2);
        offset2.value += 3;
        const xSampling = parseInt32(dataView, offset2);
        const ySampling = parseInt32(dataView, offset2);
        channels.push({
          name,
          pixelType,
          pLinear,
          xSampling,
          ySampling
        });
      }
      offset2.value += 1;
      return channels;
    }
    function parseChromaticities(dataView, offset2) {
      const redX = parseFloat32(dataView, offset2);
      const redY = parseFloat32(dataView, offset2);
      const greenX = parseFloat32(dataView, offset2);
      const greenY = parseFloat32(dataView, offset2);
      const blueX = parseFloat32(dataView, offset2);
      const blueY = parseFloat32(dataView, offset2);
      const whiteX = parseFloat32(dataView, offset2);
      const whiteY = parseFloat32(dataView, offset2);
      return { redX, redY, greenX, greenY, blueX, blueY, whiteX, whiteY };
    }
    function parseCompression(dataView, offset2) {
      const compressionCodes = [
        "NO_COMPRESSION",
        "RLE_COMPRESSION",
        "ZIPS_COMPRESSION",
        "ZIP_COMPRESSION",
        "PIZ_COMPRESSION",
        "PXR24_COMPRESSION",
        "B44_COMPRESSION",
        "B44A_COMPRESSION",
        "DWAA_COMPRESSION",
        "DWAB_COMPRESSION"
      ];
      const compression = parseUint8(dataView, offset2);
      return compressionCodes[compression];
    }
    function parseBox2i(dataView, offset2) {
      const xMin = parseInt32(dataView, offset2);
      const yMin = parseInt32(dataView, offset2);
      const xMax = parseInt32(dataView, offset2);
      const yMax = parseInt32(dataView, offset2);
      return { xMin, yMin, xMax, yMax };
    }
    function parseLineOrder(dataView, offset2) {
      const lineOrders = [
        "INCREASING_Y",
        "DECREASING_Y",
        "RANDOM_Y"
      ];
      const lineOrder = parseUint8(dataView, offset2);
      return lineOrders[lineOrder];
    }
    function parseEnvmap(dataView, offset2) {
      const envmaps = [
        "ENVMAP_LATLONG",
        "ENVMAP_CUBE"
      ];
      const envmap = parseUint8(dataView, offset2);
      return envmaps[envmap];
    }
    function parseTiledesc(dataView, offset2) {
      const levelModes = [
        "ONE_LEVEL",
        "MIPMAP_LEVELS",
        "RIPMAP_LEVELS"
      ];
      const roundingModes = [
        "ROUND_DOWN",
        "ROUND_UP"
      ];
      const xSize = parseUint32(dataView, offset2);
      const ySize = parseUint32(dataView, offset2);
      const modes = parseUint8(dataView, offset2);
      return {
        xSize,
        ySize,
        levelMode: levelModes[modes & 15],
        roundingMode: roundingModes[modes >> 4]
      };
    }
    function parseV2f(dataView, offset2) {
      const x = parseFloat32(dataView, offset2);
      const y = parseFloat32(dataView, offset2);
      return [x, y];
    }
    function parseV3f(dataView, offset2) {
      const x = parseFloat32(dataView, offset2);
      const y = parseFloat32(dataView, offset2);
      const z = parseFloat32(dataView, offset2);
      return [x, y, z];
    }
    function parseValue(dataView, buffer2, offset2, type, size) {
      if (type === "string" || type === "stringvector" || type === "iccProfile") {
        return parseFixedLengthString(buffer2, offset2, size);
      } else if (type === "chlist") {
        return parseChlist(dataView, buffer2, offset2, size);
      } else if (type === "chromaticities") {
        return parseChromaticities(dataView, offset2);
      } else if (type === "compression") {
        return parseCompression(dataView, offset2);
      } else if (type === "box2i") {
        return parseBox2i(dataView, offset2);
      } else if (type === "envmap") {
        return parseEnvmap(dataView, offset2);
      } else if (type === "tiledesc") {
        return parseTiledesc(dataView, offset2);
      } else if (type === "lineOrder") {
        return parseLineOrder(dataView, offset2);
      } else if (type === "float") {
        return parseFloat32(dataView, offset2);
      } else if (type === "v2f") {
        return parseV2f(dataView, offset2);
      } else if (type === "v3f") {
        return parseV3f(dataView, offset2);
      } else if (type === "int") {
        return parseInt32(dataView, offset2);
      } else if (type === "rational") {
        return parseRational(dataView, offset2);
      } else if (type === "timecode") {
        return parseTimecode(dataView, offset2);
      } else if (type === "preview" || type === "deepImageState" || type === "idmanifest") {
        offset2.value += size;
        return "skipped";
      } else {
        offset2.value += size;
        return void 0;
      }
    }
    function roundLog2(x, mode) {
      const log2 = Math.log2(x);
      return mode == "ROUND_DOWN" ? Math.floor(log2) : Math.ceil(log2);
    }
    function calculateTileLevels(tiledesc, w, h) {
      let num = 0;
      switch (tiledesc.levelMode) {
        case "ONE_LEVEL":
          num = 1;
          break;
        case "MIPMAP_LEVELS":
          num = roundLog2(Math.max(w, h), tiledesc.roundingMode) + 1;
          break;
        case "RIPMAP_LEVELS":
          throw new Error("THREE.EXRLoader: RIPMAP_LEVELS tiles currently unsupported.");
      }
      return num;
    }
    function calculateTiles(count, dataSize, size, roundingMode) {
      const tiles = new Array(count);
      for (let i = 0; i < count; i++) {
        const b = 1 << i;
        let s = dataSize / b | 0;
        if (roundingMode == "ROUND_UP" && s * b < dataSize) s += 1;
        const l = Math.max(s, 1);
        tiles[i] = (l + size - 1) / size | 0;
      }
      return tiles;
    }
    function parseTiles() {
      const EXRDecoder2 = this;
      const offset2 = EXRDecoder2.offset;
      const tmpOffset = { value: 0 };
      for (let tile = 0; tile < EXRDecoder2.tileCount; tile++) {
        const tileX = parseInt32(EXRDecoder2.viewer, offset2);
        const tileY = parseInt32(EXRDecoder2.viewer, offset2);
        offset2.value += 8;
        EXRDecoder2.size = parseUint32(EXRDecoder2.viewer, offset2);
        const startX = tileX * EXRDecoder2.blockWidth;
        const startY = tileY * EXRDecoder2.blockHeight;
        EXRDecoder2.columns = startX + EXRDecoder2.blockWidth > EXRDecoder2.width ? EXRDecoder2.width - startX : EXRDecoder2.blockWidth;
        EXRDecoder2.lines = startY + EXRDecoder2.blockHeight > EXRDecoder2.height ? EXRDecoder2.height - startY : EXRDecoder2.blockHeight;
        const bytesBlockLine = EXRDecoder2.columns * EXRDecoder2.totalBytes;
        const isCompressed = EXRDecoder2.size < EXRDecoder2.lines * bytesBlockLine;
        const viewer = isCompressed ? EXRDecoder2.uncompress(EXRDecoder2) : uncompressRAW(EXRDecoder2);
        offset2.value += EXRDecoder2.size;
        for (let line = 0; line < EXRDecoder2.lines; line++) {
          const lineOffset = line * EXRDecoder2.columns * EXRDecoder2.totalBytes;
          for (let channelID = 0; channelID < EXRDecoder2.inputChannels.length; channelID++) {
            const name = EXRHeader.channels[channelID].name;
            const lOff = EXRDecoder2.channelByteOffsets[name] * EXRDecoder2.columns;
            const cOff = EXRDecoder2.decodeChannels[name];
            if (cOff === void 0) continue;
            tmpOffset.value = lineOffset + lOff;
            const outLineOffset = (EXRDecoder2.height - (1 + startY + line)) * EXRDecoder2.outLineWidth;
            for (let x = 0; x < EXRDecoder2.columns; x++) {
              const outIndex = outLineOffset + (x + startX) * EXRDecoder2.outputChannels + cOff;
              EXRDecoder2.byteArray[outIndex] = EXRDecoder2.getter(viewer, tmpOffset);
            }
          }
        }
      }
    }
    function parseScanline() {
      const EXRDecoder2 = this;
      const offset2 = EXRDecoder2.offset;
      const tmpOffset = { value: 0 };
      for (let scanlineBlockIdx = 0; scanlineBlockIdx < EXRDecoder2.height / EXRDecoder2.blockHeight; scanlineBlockIdx++) {
        const line = parseInt32(EXRDecoder2.viewer, offset2) - EXRHeader.dataWindow.yMin;
        EXRDecoder2.size = parseUint32(EXRDecoder2.viewer, offset2);
        EXRDecoder2.lines = line + EXRDecoder2.blockHeight > EXRDecoder2.height ? EXRDecoder2.height - line : EXRDecoder2.blockHeight;
        const bytesPerLine = EXRDecoder2.columns * EXRDecoder2.totalBytes;
        const isCompressed = EXRDecoder2.size < EXRDecoder2.lines * bytesPerLine;
        const viewer = isCompressed ? EXRDecoder2.uncompress(EXRDecoder2) : uncompressRAW(EXRDecoder2);
        offset2.value += EXRDecoder2.size;
        for (let line_y = 0; line_y < EXRDecoder2.blockHeight; line_y++) {
          const scan_y = scanlineBlockIdx * EXRDecoder2.blockHeight;
          const true_y = line_y + EXRDecoder2.scanOrder(scan_y);
          if (true_y >= EXRDecoder2.height) continue;
          const lineOffset = line_y * bytesPerLine;
          const outLineOffset = (EXRDecoder2.height - 1 - true_y) * EXRDecoder2.outLineWidth;
          for (let channelID = 0; channelID < EXRDecoder2.inputChannels.length; channelID++) {
            const name = EXRHeader.channels[channelID].name;
            const lOff = EXRDecoder2.channelByteOffsets[name] * EXRDecoder2.columns;
            const cOff = EXRDecoder2.decodeChannels[name];
            if (cOff === void 0) continue;
            tmpOffset.value = lineOffset + lOff;
            for (let x = 0; x < EXRDecoder2.columns; x++) {
              const outIndex = outLineOffset + x * EXRDecoder2.outputChannels + cOff;
              EXRDecoder2.byteArray[outIndex] = EXRDecoder2.getter(viewer, tmpOffset);
            }
          }
        }
      }
    }
    function parseMultiPartScanline() {
      const EXRDecoder2 = this;
      const chunkOffsets = EXRDecoder2.chunkOffsets;
      const tmpOffset = { value: 0 };
      for (let chunkIdx = 0; chunkIdx < chunkOffsets.length; chunkIdx++) {
        const offset2 = { value: chunkOffsets[chunkIdx] };
        offset2.value += INT32_SIZE;
        const line = parseInt32(EXRDecoder2.viewer, offset2) - EXRHeader.dataWindow.yMin;
        EXRDecoder2.size = parseUint32(EXRDecoder2.viewer, offset2);
        EXRDecoder2.lines = line + EXRDecoder2.blockHeight > EXRDecoder2.height ? EXRDecoder2.height - line : EXRDecoder2.blockHeight;
        const bytesPerLine = EXRDecoder2.columns * EXRDecoder2.totalBytes;
        const isCompressed = EXRDecoder2.size < EXRDecoder2.lines * bytesPerLine;
        const savedOffset = EXRDecoder2.offset;
        EXRDecoder2.offset = offset2;
        const viewer = isCompressed ? EXRDecoder2.uncompress(EXRDecoder2) : uncompressRAW(EXRDecoder2);
        EXRDecoder2.offset = savedOffset;
        for (let line_y = 0; line_y < EXRDecoder2.blockHeight; line_y++) {
          const true_y = line_y + line;
          if (true_y >= EXRDecoder2.height) continue;
          const lineOffset = line_y * bytesPerLine;
          const outLineOffset = (EXRDecoder2.height - 1 - true_y) * EXRDecoder2.outLineWidth;
          for (let channelID = 0; channelID < EXRDecoder2.inputChannels.length; channelID++) {
            const name = EXRHeader.channels[channelID].name;
            const lOff = EXRDecoder2.channelByteOffsets[name] * EXRDecoder2.columns;
            const cOff = EXRDecoder2.decodeChannels[name];
            if (cOff === void 0) continue;
            tmpOffset.value = lineOffset + lOff;
            for (let x = 0; x < EXRDecoder2.columns; x++) {
              const outIndex = outLineOffset + x * EXRDecoder2.outputChannels + cOff;
              EXRDecoder2.byteArray[outIndex] = EXRDecoder2.getter(viewer, tmpOffset);
            }
          }
        }
      }
    }
    function decompressDeepData(array, compressedOffset, compressedSize, compression) {
      if (compressedSize === 0) return null;
      const compressed = array.slice(compressedOffset, compressedOffset + compressedSize);
      switch (compression) {
        case "NO_COMPRESSION":
          return new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
        case "RLE_COMPRESSION": {
          const rawBuffer = new Uint8Array(decodeRunLength(compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength)));
          const tmpBuffer = new Uint8Array(rawBuffer.length);
          predictor(rawBuffer);
          interleaveScalar(rawBuffer, tmpBuffer);
          return new DataView(tmpBuffer.buffer);
        }
        case "ZIPS_COMPRESSION": {
          const rawBuffer = unzlibSync(compressed);
          const tmpBuffer = new Uint8Array(rawBuffer.length);
          predictor(rawBuffer);
          interleaveScalar(rawBuffer, tmpBuffer);
          return new DataView(tmpBuffer.buffer);
        }
        default:
          throw new Error("EXRLoader.parse: " + compression + " is unsupported for deep data");
      }
    }
    function parseDeepScanline() {
      const EXRDecoder2 = this;
      const chunkOffsets = EXRDecoder2.chunkOffsets;
      const width = EXRDecoder2.width;
      const height = EXRDecoder2.height;
      const deepChannels = EXRDecoder2.deepChannels;
      const compression = EXRHeader.compression;
      const isMultiPart = EXRDecoder2.multiPart;
      const decodeChannels = EXRDecoder2.decodeChannels;
      const outputChannels = EXRDecoder2.outputChannels;
      const isHalfOutput = EXRDecoder2.byteArray instanceof Uint16Array;
      let alphaChannelIdx = -1;
      for (let i = 0; i < deepChannels.length; i++) {
        if (deepChannels[i].name === "A") {
          alphaChannelIdx = i;
          break;
        }
      }
      for (let chunkIdx = 0; chunkIdx < chunkOffsets.length; chunkIdx++) {
        const chunkOffset = { value: chunkOffsets[chunkIdx] };
        if (isMultiPart) chunkOffset.value += INT32_SIZE;
        const line = parseInt32(EXRDecoder2.viewer, chunkOffset) - EXRHeader.dataWindow.yMin;
        const sctCompressedSize = parseInt64(EXRDecoder2.viewer, chunkOffset);
        const dataCompressedSize = parseInt64(EXRDecoder2.viewer, chunkOffset);
        parseInt64(EXRDecoder2.viewer, chunkOffset);
        const sctView = decompressDeepData(EXRDecoder2.array, chunkOffset.value, sctCompressedSize, compression);
        chunkOffset.value += sctCompressedSize;
        if (sctView === null) continue;
        const cumulativeCounts = new Uint32Array(width);
        for (let x = 0; x < width; x++) {
          cumulativeCounts[x] = sctView.getUint32(x * 4, true);
        }
        const totalSamples = cumulativeCounts[width - 1];
        if (totalSamples === 0) {
          chunkOffset.value += dataCompressedSize;
          continue;
        }
        const pixelView = decompressDeepData(EXRDecoder2.array, chunkOffset.value, dataCompressedSize, compression);
        const channelOffsets = [];
        let bytePos = 0;
        for (let i = 0; i < deepChannels.length; i++) {
          channelOffsets.push(bytePos);
          bytePos += totalSamples * deepChannels[i].bytesPerSample;
        }
        const outLineOffset = (height - 1 - line) * EXRDecoder2.outLineWidth;
        for (let x = 0; x < width; x++) {
          const startSample = x === 0 ? 0 : cumulativeCounts[x - 1];
          const endSample = cumulativeCounts[x];
          const numSamples = endSample - startSample;
          if (numSamples === 0) continue;
          const composited = new Float32Array(outputChannels);
          let compositedAlpha = 0;
          for (let s = 0; s < numSamples; s++) {
            const sampleIdx = startSample + s;
            const factor = 1 - compositedAlpha;
            if (factor <= 0) break;
            let sampleAlpha = 1;
            if (alphaChannelIdx >= 0) {
              const aBps = deepChannels[alphaChannelIdx].bytesPerSample;
              const aOff = channelOffsets[alphaChannelIdx] + sampleIdx * aBps;
              sampleAlpha = aBps === 2 ? decodeFloat16(pixelView.getUint16(aOff, true)) : pixelView.getFloat32(aOff, true);
            }
            for (let ci = 0; ci < deepChannels.length; ci++) {
              const ch = deepChannels[ci];
              const cOff = decodeChannels[ch.name];
              if (cOff === void 0) continue;
              const bps = ch.bytesPerSample;
              const dataOff = channelOffsets[ci] + sampleIdx * bps;
              const value = bps === 2 ? decodeFloat16(pixelView.getUint16(dataOff, true)) : pixelView.getFloat32(dataOff, true);
              composited[cOff] += value * factor;
            }
            compositedAlpha += sampleAlpha * factor;
          }
          if (decodeChannels["A"] !== void 0) {
            composited[decodeChannels["A"]] = compositedAlpha;
          }
          const outIndex = outLineOffset + x * outputChannels;
          for (let c = 0; c < outputChannels; c++) {
            EXRDecoder2.byteArray[outIndex + c] = isHalfOutput ? DataUtils.toHalfFloat(composited[c]) : composited[c];
          }
        }
      }
    }
    function parsePartHeader(dataView, buffer2, offset2) {
      const header = {};
      let hasAttributes = false;
      while (true) {
        const attributeName = parseNullTerminatedString(buffer2, offset2);
        if (attributeName === "") break;
        hasAttributes = true;
        const attributeType = parseNullTerminatedString(buffer2, offset2);
        const attributeSize = parseUint32(dataView, offset2);
        const attributeValue = parseValue(dataView, buffer2, offset2, attributeType, attributeSize);
        if (attributeValue === void 0) {
          console.warn(`THREE.EXRLoader: Skipped unknown header attribute type '${attributeType}'.`);
        } else {
          header[attributeName] = attributeValue;
        }
      }
      return hasAttributes ? header : null;
    }
    function parseHeader(dataView, buffer2, offset2) {
      if (dataView.getUint32(0, true) != 20000630) {
        throw new Error("THREE.EXRLoader: Provided file doesn't appear to be in OpenEXR format.");
      }
      const version = dataView.getUint8(4);
      const spec = dataView.getUint8(5);
      const flags = {
        singleTile: !!(spec & 2),
        longName: !!(spec & 4),
        deepFormat: !!(spec & 8),
        multiPart: !!(spec & 16)
      };
      offset2.value = 8;
      const headers = [];
      if (flags.multiPart) {
        while (true) {
          const header = parsePartHeader(dataView, buffer2, offset2);
          if (header === null) break;
          header.version = version;
          header.spec = flags;
          headers.push(header);
        }
        if (headers.length === 0) {
          throw new Error("THREE.EXRLoader: No valid part headers found.");
        }
      } else {
        const header = parsePartHeader(dataView, buffer2, offset2);
        header.version = version;
        header.spec = flags;
        headers.push(header);
      }
      return headers;
    }
    function setupDecoder(EXRHeader2, dataView, uInt8Array2, offset2, outputType, outputFormat) {
      const EXRDecoder2 = {
        size: 0,
        viewer: dataView,
        array: uInt8Array2,
        offset: offset2,
        width: EXRHeader2.dataWindow.xMax - EXRHeader2.dataWindow.xMin + 1,
        height: EXRHeader2.dataWindow.yMax - EXRHeader2.dataWindow.yMin + 1,
        inputChannels: EXRHeader2.channels,
        channelByteOffsets: {},
        shouldExpand: false,
        yCbCr: false,
        scanOrder: null,
        totalBytes: null,
        columns: null,
        lines: null,
        type: null,
        uncompress: null,
        getter: null,
        format: null,
        colorSpace: LinearSRGBColorSpace
      };
      switch (EXRHeader2.compression) {
        case "NO_COMPRESSION":
          EXRDecoder2.blockHeight = 1;
          EXRDecoder2.uncompress = uncompressRAW;
          break;
        case "RLE_COMPRESSION":
          EXRDecoder2.blockHeight = 1;
          EXRDecoder2.uncompress = uncompressRLE;
          break;
        case "ZIPS_COMPRESSION":
          EXRDecoder2.blockHeight = 1;
          EXRDecoder2.uncompress = uncompressZIP;
          break;
        case "ZIP_COMPRESSION":
          EXRDecoder2.blockHeight = 16;
          EXRDecoder2.uncompress = uncompressZIP;
          break;
        case "PIZ_COMPRESSION":
          EXRDecoder2.blockHeight = 32;
          EXRDecoder2.uncompress = uncompressPIZ;
          break;
        case "PXR24_COMPRESSION":
          EXRDecoder2.blockHeight = 16;
          EXRDecoder2.uncompress = uncompressPXR;
          break;
        case "B44_COMPRESSION":
        case "B44A_COMPRESSION":
          EXRDecoder2.blockHeight = 32;
          EXRDecoder2.uncompress = uncompressB44;
          break;
        case "DWAA_COMPRESSION":
          EXRDecoder2.blockHeight = 32;
          EXRDecoder2.uncompress = uncompressDWA;
          break;
        case "DWAB_COMPRESSION":
          EXRDecoder2.blockHeight = 256;
          EXRDecoder2.uncompress = uncompressDWA;
          break;
        default:
          throw new Error("EXRLoader.parse: " + EXRHeader2.compression + " is unsupported");
      }
      const channels = {};
      for (const channel of EXRHeader2.channels) {
        switch (channel.name) {
          case "BY":
          case "RY":
          case "Y":
          case "R":
          case "G":
          case "B":
          case "A":
            channels[channel.name] = true;
            EXRDecoder2.type = channel.pixelType;
        }
      }
      let fillAlpha = false;
      let invalidOutput = false;
      if (channels.Y && channels.RY && channels.BY) {
        EXRDecoder2.outputChannels = 4;
        EXRDecoder2.yCbCr = true;
      } else if (channels.R && channels.G && channels.B) {
        EXRDecoder2.outputChannels = 4;
      } else if (channels.Y) {
        EXRDecoder2.outputChannels = 1;
      } else {
        throw new Error("EXRLoader.parse: file contains unsupported data channels.");
      }
      switch (EXRDecoder2.outputChannels) {
        case 4:
          if (outputFormat == RGBAFormat) {
            fillAlpha = !channels.A;
            EXRDecoder2.format = RGBAFormat;
            EXRDecoder2.colorSpace = LinearSRGBColorSpace;
            EXRDecoder2.outputChannels = 4;
            EXRDecoder2.decodeChannels = { R: 0, G: 1, B: 2, A: 3 };
          } else if (outputFormat == RGFormat) {
            EXRDecoder2.format = RGFormat;
            EXRDecoder2.colorSpace = LinearSRGBColorSpace;
            EXRDecoder2.outputChannels = 2;
            EXRDecoder2.decodeChannels = { R: 0, G: 1 };
          } else if (outputFormat == RedFormat) {
            EXRDecoder2.format = RedFormat;
            EXRDecoder2.colorSpace = LinearSRGBColorSpace;
            EXRDecoder2.outputChannels = 1;
            EXRDecoder2.decodeChannels = { R: 0 };
          } else {
            invalidOutput = true;
          }
          break;
        case 1:
          if (outputFormat == RGBAFormat) {
            fillAlpha = true;
            EXRDecoder2.format = RGBAFormat;
            EXRDecoder2.colorSpace = LinearSRGBColorSpace;
            EXRDecoder2.outputChannels = 4;
            EXRDecoder2.shouldExpand = true;
            EXRDecoder2.decodeChannels = { Y: 0 };
          } else if (outputFormat == RGFormat) {
            EXRDecoder2.format = RGFormat;
            EXRDecoder2.colorSpace = LinearSRGBColorSpace;
            EXRDecoder2.outputChannels = 2;
            EXRDecoder2.shouldExpand = true;
            EXRDecoder2.decodeChannels = { Y: 0 };
          } else if (outputFormat == RedFormat) {
            EXRDecoder2.format = RedFormat;
            EXRDecoder2.colorSpace = LinearSRGBColorSpace;
            EXRDecoder2.outputChannels = 1;
            EXRDecoder2.decodeChannels = { Y: 0 };
          } else {
            invalidOutput = true;
          }
          break;
        default:
          invalidOutput = true;
      }
      if (invalidOutput) throw new Error("EXRLoader.parse: invalid output format for specified file.");
      if (EXRDecoder2.yCbCr) {
        EXRDecoder2.format = RGBAFormat;
        EXRDecoder2.outputChannels = 4;
        EXRDecoder2.decodeChannels = { Y: 0, RY: 1, BY: 2 };
        fillAlpha = true;
      }
      if (EXRDecoder2.type == 1) {
        switch (outputType) {
          case FloatType:
            EXRDecoder2.getter = parseFloat16;
            break;
          case HalfFloatType:
            EXRDecoder2.getter = parseUint16;
            break;
        }
      } else if (EXRDecoder2.type == 2) {
        switch (outputType) {
          case FloatType:
            EXRDecoder2.getter = parseFloat32;
            break;
          case HalfFloatType:
            EXRDecoder2.getter = decodeFloat32;
        }
      } else {
        throw new Error("EXRLoader.parse: unsupported pixelType " + EXRDecoder2.type + " for " + EXRHeader2.compression + ".");
      }
      EXRDecoder2.columns = EXRDecoder2.width;
      const size = EXRDecoder2.width * EXRDecoder2.height * EXRDecoder2.outputChannels;
      switch (outputType) {
        case FloatType:
          EXRDecoder2.byteArray = new Float32Array(size);
          if (fillAlpha)
            EXRDecoder2.byteArray.fill(1, 0, size);
          break;
        case HalfFloatType:
          EXRDecoder2.byteArray = new Uint16Array(size);
          if (fillAlpha)
            EXRDecoder2.byteArray.fill(15360, 0, size);
          break;
        default:
          console.error("THREE.EXRLoader: unsupported type: ", outputType);
          break;
      }
      let byteOffset = 0;
      for (const channel of EXRHeader2.channels) {
        if (EXRDecoder2.decodeChannels[channel.name] !== void 0) {
          EXRDecoder2.channelByteOffsets[channel.name] = byteOffset;
        }
        byteOffset += channel.pixelType * 2;
      }
      EXRDecoder2.totalBytes = byteOffset;
      EXRDecoder2.outLineWidth = EXRDecoder2.width * EXRDecoder2.outputChannels;
      if (EXRHeader2.lineOrder === "INCREASING_Y") {
        EXRDecoder2.scanOrder = (y) => y;
      } else {
        EXRDecoder2.scanOrder = (y) => EXRDecoder2.height - 1 - y;
      }
      if (EXRHeader2.spec.deepFormat) {
        EXRDecoder2.deepChannels = [];
        let deepBytesPerSample = 0;
        for (const channel of EXRHeader2.channels) {
          const bytesPerSample = channel.pixelType === 0 ? 4 : channel.pixelType * 2;
          EXRDecoder2.deepChannels.push({
            name: channel.name,
            pixelType: channel.pixelType,
            bytesPerSample
          });
          deepBytesPerSample += bytesPerSample;
        }
        EXRDecoder2.deepBytesPerSample = deepBytesPerSample;
        EXRDecoder2.chunkOffsets = EXRHeader2._chunkOffsets;
        EXRDecoder2.multiPart = EXRHeader2.spec.multiPart;
        EXRDecoder2.decode = parseDeepScanline.bind(EXRDecoder2);
      } else if (EXRHeader2.spec.singleTile) {
        EXRDecoder2.blockHeight = EXRHeader2.tiles.ySize;
        EXRDecoder2.blockWidth = EXRHeader2.tiles.xSize;
        const numXLevels = calculateTileLevels(EXRHeader2.tiles, EXRDecoder2.width, EXRDecoder2.height);
        const numXTiles = calculateTiles(numXLevels, EXRDecoder2.width, EXRHeader2.tiles.xSize, EXRHeader2.tiles.roundingMode);
        const numYTiles = calculateTiles(numXLevels, EXRDecoder2.height, EXRHeader2.tiles.ySize, EXRHeader2.tiles.roundingMode);
        EXRDecoder2.tileCount = numXTiles[0] * numYTiles[0];
        for (let l = 0; l < numXLevels; l++)
          for (let y = 0; y < numYTiles[l]; y++)
            for (let x = 0; x < numXTiles[l]; x++)
              parseInt64(dataView, offset2);
        EXRDecoder2.decode = parseTiles.bind(EXRDecoder2);
      } else if (EXRHeader2.spec.multiPart) {
        EXRDecoder2.blockWidth = EXRDecoder2.width;
        EXRDecoder2.chunkOffsets = EXRHeader2._chunkOffsets;
        EXRDecoder2.decode = parseMultiPartScanline.bind(EXRDecoder2);
      } else {
        EXRDecoder2.blockWidth = EXRDecoder2.width;
        const blockCount = Math.ceil(EXRDecoder2.height / EXRDecoder2.blockHeight);
        for (let i = 0; i < blockCount; i++)
          parseInt64(dataView, offset2);
        EXRDecoder2.decode = parseScanline.bind(EXRDecoder2);
      }
      return EXRDecoder2;
    }
    const offset = { value: 0 };
    const bufferDataView = new DataView(buffer);
    const uInt8Array = new Uint8Array(buffer);
    const EXRHeaders = parseHeader(bufferDataView, buffer, offset);
    const partIndex = Math.max(0, Math.min(this.part, EXRHeaders.length - 1));
    const EXRHeader = EXRHeaders[partIndex];
    if (EXRHeader.spec.multiPart || EXRHeader.spec.deepFormat) {
      for (let p = 0; p < EXRHeaders.length; p++) {
        const chunkCount = EXRHeaders[p].chunkCount;
        if (p === partIndex) {
          EXRHeader._chunkOffsets = [];
          for (let i = 0; i < chunkCount; i++)
            EXRHeader._chunkOffsets.push(parseInt64(bufferDataView, offset));
        } else {
          for (let i = 0; i < chunkCount; i++)
            parseInt64(bufferDataView, offset);
        }
      }
    }
    const EXRDecoder = setupDecoder(EXRHeader, bufferDataView, uInt8Array, offset, this.type, this.outputFormat);
    EXRDecoder.decode();
    if (EXRDecoder.shouldExpand) {
      const byteArray = EXRDecoder.byteArray;
      if (this.outputFormat == RGBAFormat) {
        for (let i = 0; i < byteArray.length; i += 4)
          byteArray[i + 2] = byteArray[i + 1] = byteArray[i];
      } else if (this.outputFormat == RGFormat) {
        for (let i = 0; i < byteArray.length; i += 2)
          byteArray[i + 1] = byteArray[i];
      }
    }
    if (EXRDecoder.yCbCr) {
      const byteArray = EXRDecoder.byteArray;
      const nPixels = EXRDecoder.width * EXRDecoder.height;
      if (this.type === HalfFloatType) {
        for (let i = 0; i < nPixels; i++) {
          const base = i * 4;
          const Y = decodeFloat16(byteArray[base]);
          const RY = decodeFloat16(byteArray[base + 1]);
          const BY = decodeFloat16(byteArray[base + 2]);
          const R = (1 + RY) * Y;
          const B = (1 + BY) * Y;
          const G = (Y - R * 0.2126 - B * 0.0722) / 0.7152;
          byteArray[base] = DataUtils.toHalfFloat(Math.max(0, R));
          byteArray[base + 1] = DataUtils.toHalfFloat(Math.max(0, G));
          byteArray[base + 2] = DataUtils.toHalfFloat(Math.max(0, B));
        }
      } else {
        for (let i = 0; i < nPixels; i++) {
          const base = i * 4;
          const Y = byteArray[base];
          const RY = byteArray[base + 1];
          const BY = byteArray[base + 2];
          const R = (1 + RY) * Y;
          const B = (1 + BY) * Y;
          byteArray[base] = Math.max(0, R);
          byteArray[base + 1] = Math.max(0, (Y - R * 0.2126 - B * 0.0722) / 0.7152);
          byteArray[base + 2] = Math.max(0, B);
        }
      }
    }
    return {
      header: EXRHeader,
      width: EXRDecoder.width,
      height: EXRDecoder.height,
      data: EXRDecoder.byteArray,
      format: EXRDecoder.format,
      colorSpace: EXRDecoder.colorSpace,
      type: this.type
    };
  }
  /**
   * Sets the texture type.
   *
   * @param {(HalfFloatType|FloatType)} value - The texture type to set.
   * @return {EXRLoader} A reference to this loader.
   */
  setDataType(value) {
    this.type = value;
    return this;
  }
  /**
   * Sets texture output format. Defaults to `RGBAFormat`.
   *
   * @param {(RGBAFormat|RGFormat|RedFormat)} value - Texture output format.
   * @return {EXRLoader} A reference to this loader.
   */
  setOutputFormat(value) {
    this.outputFormat = value;
    return this;
  }
  /**
   * For multi-part EXR files, sets which part to load.
   *
   * @param {number} value - The part index to load.
   * @return {EXRLoader} A reference to this loader.
   */
  setPart(value) {
    this.part = value;
    return this;
  }
  load(url, onLoad, onProgress, onError) {
    function onLoadCallback(texture, texData) {
      texture.colorSpace = texData.colorSpace;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      if (onLoad) onLoad(texture, texData);
    }
    return super.load(url, onLoadCallback, onProgress, onError);
  }
};
export {
  EXRLoader
};
//# sourceMappingURL=three_addons_loaders_EXRLoader__js.js.map
