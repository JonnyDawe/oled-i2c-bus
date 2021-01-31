"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Oled = void 0;
var TransferType;
(function (TransferType) {
    TransferType[TransferType["Command"] = 0] = "Command";
    TransferType[TransferType["Data"] = 1] = "Data";
})(TransferType || (TransferType = {}));
class Oled {
    constructor(i2c, opts) {
        this.PROTOCOL = 'I2C';
        this._textCursor = { x: 0, y: 0 };
        this._waitUntilReady = (callback) => {
            const tick = (callback) => {
                this._readI2C((byte) => {
                    const busy = byte >> 7 & 1;
                    if (!busy) {
                        callback();
                    }
                    else {
                        console.log('I\'m busy!');
                        setTimeout(tick, 0);
                    }
                });
            };
            setTimeout(function () { tick(callback); }, 0);
        };
        this.HEIGHT = opts.height || 32;
        this.WIDTH = opts.width || 128;
        this.ADDRESS = opts.address || 0x3C;
        this.LINESPACING = opts.lineSpacing ? opts.lineSpacing : 2;
        this.LETTERSPACING = opts.letterSpacing ? opts.letterSpacing : 1;
        this.ssdType = opts.ssdType ? opts.ssdType : "ssd1306";
        this.DATA = opts.data || 0x40;
        this.COMMAND = opts.command || 0x00;
        this.buffer = Buffer.alloc((this.WIDTH * this.HEIGHT) / 8);
        this.buffer.fill(0x00);
        this.dirtyBytes = [];
        const config = {
            "ssd1306": {
                '128x32': {
                    'multiplex': 0x1F,
                    'compins': 0x02,
                    'coloffset': 0
                },
                '128x64': {
                    'multiplex': 0x3F,
                    'compins': 0x12,
                    'coloffset': 0
                },
                '96x16': {
                    'multiplex': 0x0F,
                    'compins': 0x2,
                    'coloffset': 0,
                }
            },
            "ssd1305": {
                '128x32': {
                    'multiplex': 0x1F,
                    'compins': 0x12,
                    'coloffset': 4
                }
            }
        };
        this.wire = i2c;
        const screenSize = `${this.WIDTH}x${this.HEIGHT}`;
        this.screenConfig = opts.screenConfig ? opts.screenConfig : config[this.ssdType][screenSize];
        this._initialise();
    }
    set textCursor(position) {
        this._textCursor = position;
    }
    get textCursor() {
        return this._textCursor;
    }
    _initialise() {
        const initSeq = [
            Oled.DISPLAY_OFF,
            Oled.SET_DISPLAY_CLOCK_DIV, 0x80,
            Oled.SET_MULTIPLEX, this.screenConfig.multiplex,
            Oled.SET_DISPLAY_OFFSET, 0x00,
            Oled.SET_START_LINE,
            Oled.CHARGE_PUMP, 0x14,
            Oled.MEMORY_MODE, 0x00,
            Oled.SEG_REMAP,
            Oled.COM_SCAN_DEC,
            Oled.SET_COM_PINS, this.screenConfig.compins,
            Oled.SET_CONTRAST, 0x8F,
            Oled.SET_PRECHARGE, 0xF1,
            Oled.SET_VCOM_DETECT, 0x40,
            Oled.DISPLAY_ALL_ON_RESUME,
            Oled.NORMAL_DISPLAY,
            Oled.DISPLAY_ON
        ];
        for (let i = 0; i < initSeq.length; i++) {
            this._transfer(TransferType.Command, initSeq[i]);
        }
    }
    _transfer(type, val, callback) {
        let control;
        if (type === TransferType.Data) {
            control = this.DATA;
        }
        else if (type === TransferType.Command) {
            control = this.COMMAND;
        }
        else {
            return;
        }
        const bufferForSend = Buffer.from([control, val]);
        const sentCount = this.wire.i2cWriteSync(this.ADDRESS, 2, bufferForSend);
        if (callback) {
            callback();
        }
    }
    _readI2C(callback) {
        let data = [0];
        let buff = Buffer.from(data);
        this.wire.i2cReadSync(this.ADDRESS, 1, buff);
        callback(buff[0]);
    }
    _invertColor(color) {
        return (color === 0) ? 1 : 0;
    }
    writeString(font, size, string, color, wrap, linespacing = this.LINESPACING, letterspacing = this.LETTERSPACING, sync) {
        const immed = (typeof sync === 'undefined') ? true : sync;
        const wordArr = string.split(' ');
        const len = wordArr.length;
        let offset = this.textCursor.x;
        let padding = 0;
        const letspace = letterspacing;
        const leading = linespacing;
        for (let i = 0; i < len; i += 1) {
            if (i < len - 1) {
                wordArr[i] += ' ';
            }
            const stringArr = wordArr[i].split('');
            const slen = stringArr.length;
            const compare = (font.width * size * slen) + (size * (len - 1));
            if (wrap && len > 1 && (offset >= (this.WIDTH - compare))) {
                offset = 1;
                this.textCursor = {
                    x: offset,
                    y: this._textCursor.y + (font.height * size) + size + leading
                };
            }
            for (let i = 0; i < slen; i += 1) {
                const charBuf = this._findCharBuf(font, stringArr[i]);
                const charBytes = this._readCharBytes(charBuf);
                this._drawChar(font, charBytes, size, color, false);
                this.fillRect(offset - padding, this._textCursor.y, padding, (font.height * size), this._invertColor(color), false);
                padding = (stringArr[i] === ' ') ? 0 : size + letspace;
                offset += (font.width * size) + padding;
                if (wrap && (offset >= (this.WIDTH - font.width - letspace))) {
                    offset = 1;
                    this._textCursor.y += (font.height * size) + size + leading;
                }
                this.textCursor = {
                    x: offset,
                    y: this._textCursor.y
                };
            }
        }
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }
    _drawChar(font, byteArray, size, color, sync) {
        const x = this._textCursor.x;
        const y = this._textCursor.y;
        let c = 0;
        let pagePos = 0;
        for (let i = 0; i < byteArray.length; i += 1) {
            pagePos = Math.floor(i / font.width) * 8;
            for (let j = 0; j < 8; j += 1) {
                const pixelState = (byteArray[i][j] === 1) ? color : this._invertColor(color);
                let xpos;
                let ypos;
                if (size === 1) {
                    xpos = x + c;
                    ypos = y + j + pagePos;
                    this.drawPixel([xpos, ypos, pixelState], false);
                }
                else {
                    xpos = x + (i * size);
                    ypos = y + (j * size);
                    this.fillRect(xpos, ypos, size, size, pixelState, false);
                }
            }
            c = (c < font.width - 1) ? c += 1 : 0;
        }
    }
    _readCharBytes(byteArray) {
        let bitArr = [];
        const bitCharArr = [];
        for (let i = 0; i < byteArray.length; i += 1) {
            const byte = byteArray[i];
            for (let j = 0; j < 8; j += 1) {
                const bit = byte >> j & 1;
                bitArr.push(bit);
            }
            bitCharArr.push(bitArr);
            bitArr = [];
        }
        return bitCharArr;
    }
    _findCharBuf(font, c) {
        const charLength = Math.ceil((font.width * font.height) / 8);
        const cBufPos = font.lookup.indexOf(c) * charLength;
        return font.fontData.slice(cBufPos, cBufPos + charLength);
    }
    update() {
        this._waitUntilReady(() => {
            const displaySeq = [
                Oled.COLUMN_ADDR,
                this.screenConfig.coloffset,
                this.screenConfig.coloffset + this.WIDTH - 1,
                Oled.PAGE_ADDR, 0, (this.HEIGHT / 8) - 1
            ];
            const displaySeqLen = displaySeq.length;
            const bufferLen = this.buffer.length;
            for (let i = 0; i < displaySeqLen; i += 1) {
                this._transfer(TransferType.Command, displaySeq[i]);
            }
            const bufferToSend = Buffer.concat([Buffer.from([0x40]), this.buffer]);
            const sentCount = this.wire.i2cWriteSync(this.ADDRESS, bufferToSend.length, bufferToSend);
        });
        this.dirtyBytes = [];
    }
    dimDisplay(bool) {
        let contrast;
        if (bool) {
            contrast = 0;
        }
        else {
            contrast = 0xCF;
        }
        this._transfer(TransferType.Command, Oled.SET_CONTRAST);
        this._transfer(TransferType.Command, contrast);
    }
    turnOffDisplay() {
        this._transfer(TransferType.Command, Oled.DISPLAY_OFF);
    }
    turnOnDisplay() {
        this._transfer(TransferType.Command, Oled.DISPLAY_ON);
    }
    clearDisplay(sync) {
        const immed = (typeof sync === 'undefined') ? true : sync;
        this.update();
        for (let i = 0; i < this.buffer.length; i += 1) {
            if (this.buffer[i] !== 0x00) {
                this.buffer[i] = 0x00;
                if (this.dirtyBytes.indexOf(i) === -1) {
                    this.dirtyBytes.push(i);
                }
            }
        }
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }
    invertDisplay(bool) {
        if (bool) {
            this._transfer(TransferType.Command, Oled.INVERT_DISPLAY);
        }
        else {
            this._transfer(TransferType.Command, Oled.NORMAL_DISPLAY);
        }
    }
    _isSinglePixel(pixels) {
        return typeof pixels[0] !== 'object';
    }
    drawPixel(pixels, sync) {
        const immed = (typeof sync === 'undefined') ? true : sync;
        if (this._isSinglePixel(pixels))
            pixels = [pixels];
        pixels.forEach((el) => {
            const [x, y, color] = el;
            if (x > this.WIDTH || y > this.HEIGHT)
                return;
            let byte = 0;
            const page = Math.floor(y / 8);
            const pageShift = 0x01 << (y - 8 * page);
            (page === 0) ? byte = x : byte = x + (this.WIDTH * page);
            if (color === 0) {
                this.buffer[byte] &= ~pageShift;
            }
            else {
                this.buffer[byte] |= pageShift;
            }
            if (this.dirtyBytes.indexOf(byte) === -1) {
                this.dirtyBytes.push(byte);
            }
        }, this);
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }
    _updateDirtyBytes(byteArray) {
        const blen = byteArray.length;
        if (blen > (this.buffer.length / 7)) {
            this.update();
            this.dirtyBytes = [];
            return;
        }
        this._waitUntilReady(() => {
            let pageStart = Infinity;
            let pageEnd = 0;
            let colStart = Infinity;
            let colEnd = 0;
            let any = false;
            for (let i = 0; i < blen; i += 1) {
                const b = byteArray[i];
                if ((b >= 0) && (b < this.buffer.length)) {
                    const page = b / this.screenConfig.coloffset + this.WIDTH - 1 | 0;
                    if (page < pageStart)
                        pageStart = page;
                    if (page > pageEnd)
                        pageEnd = page;
                    const col = b % this.screenConfig.coloffset + this.WIDTH - 1;
                    if (col < colStart)
                        colStart = col;
                    if (col > colEnd)
                        colEnd = col;
                    any = true;
                }
            }
            if (!any)
                return;
            colStart += this.screenConfig.coloffset;
            colEnd += this.screenConfig.coloffset;
            const displaySeq = [
                Oled.COLUMN_ADDR, colStart, colEnd,
                Oled.PAGE_ADDR, pageStart, pageEnd
            ];
            const displaySeqLen = displaySeq.length;
            for (let i = 0; i < displaySeqLen; i += 1) {
                this._transfer(TransferType.Command, displaySeq[i]);
            }
            for (let i = pageStart; i <= pageEnd; i += 1) {
                for (let j = colStart; j <= colEnd; j += 1) {
                    this._transfer(TransferType.Data, this.buffer[this.WIDTH * i + j]);
                }
            }
        });
        this.dirtyBytes = [];
    }
    drawLine(x0, y0, x1, y1, color, sync) {
        const immed = (typeof sync === 'undefined') ? true : sync;
        const dx = Math.abs(x1 - x0);
        const sx = x0 < x1 ? 1 : -1;
        const dy = Math.abs(y1 - y0);
        const sy = y0 < y1 ? 1 : -1;
        let err = (dx > dy ? dx : -dy) / 2;
        while (true) {
            this.drawPixel([x0, y0, color], false);
            if (x0 === x1 && y0 === y1)
                break;
            const e2 = err;
            if (e2 > -dx) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dy) {
                err += dx;
                y0 += sy;
            }
        }
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }
    drawRect(x, y, w, h, color, sync) {
        const immed = (typeof sync === 'undefined') ? true : sync;
        this.drawLine(x, y, x + w, y, color, false);
        this.drawLine(x, y + 1, x, y + h - 1, color, false);
        this.drawLine(x + w, y + 1, x + w, y + h - 1, color, false);
        this.drawLine(x, y + h - 1, x + w, y + h - 1, color, false);
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }
    ;
    fillRect(x, y, w, h, color, sync) {
        const immed = (typeof sync === 'undefined') ? true : sync;
        for (let i = x; i < x + w; i += 1) {
            this.drawLine(i, y, i, y + h - 1, color, false);
        }
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }
    drawCircle(x0, y0, r, color, sync) {
        const immed = (typeof sync === 'undefined') ? true : sync;
        let f = 1 - r;
        let ddF_x = 1;
        let ddF_y = -2 * r;
        let x = 0;
        let y = r;
        this.drawPixel([[x0, y0 + r, color],
            [x0, y0 - r, color],
            [x0 + r, y0, color],
            [x0 - r, y0, color]], false);
        while (x < y) {
            if (f >= 0) {
                y--;
                ddF_y += 2;
                f += ddF_y;
            }
            x++;
            ddF_x += 2;
            f += ddF_x;
            this.drawPixel([[x0 + x, y0 + y, color],
                [x0 - x, y0 + y, color],
                [x0 + x, y0 - y, color],
                [x0 - x, y0 - y, color],
                [x0 + y, y0 + x, color],
                [x0 - y, y0 + x, color],
                [x0 + y, y0 - x, color],
                [x0 - y, y0 - x, color]], false);
        }
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }
    ;
    startScroll(dir, start, stop) {
        const cmdSeq = [];
        switch (dir) {
            case 'right':
                cmdSeq.push(Oled.RIGHT_HORIZONTAL_SCROLL);
                break;
            case 'left':
                cmdSeq.push(Oled.LEFT_HORIZONTAL_SCROLL);
                break;
            case 'left diagonal':
                cmdSeq.push(Oled.SET_VERTICAL_SCROLL_AREA, 0x00, this.HEIGHT, Oled.VERTICAL_AND_LEFT_HORIZONTAL_SCROLL, 0x00, start, 0x00, stop, 0x01, Oled.ACTIVATE_SCROLL);
                break;
            case 'right diagonal':
                cmdSeq.push(Oled.SET_VERTICAL_SCROLL_AREA, 0x00, this.HEIGHT, Oled.VERTICAL_AND_RIGHT_HORIZONTAL_SCROLL, 0x00, start, 0x00, stop, 0x01, Oled.ACTIVATE_SCROLL);
                break;
        }
        this._waitUntilReady(() => {
            if (dir === 'right' || dir === 'left') {
                cmdSeq.push(0x001b, start, 0x011B, stop);
                if (this.ssdType === "ssd1306") {
                    cmdSeq.push(0x00, 0xFF);
                }
                cmdSeq.push(Oled.ACTIVATE_SCROLL);
            }
            for (let i = 0; i < cmdSeq.length; i += 1) {
                this._transfer(TransferType.Command, cmdSeq[i]);
            }
        });
    }
    stopScroll() {
        this._transfer(TransferType.Command, Oled.DEACTIVATE_SCROLL);
    }
}
exports.Oled = Oled;
Oled.DISPLAY_OFF = 0xAE;
Oled.DISPLAY_ON = 0xAF;
Oled.SET_DISPLAY_CLOCK_DIV = 0xD5;
Oled.SET_MULTIPLEX = 0xA8;
Oled.SET_DISPLAY_OFFSET = 0xD3;
Oled.SET_START_LINE = 0x00;
Oled.CHARGE_PUMP = 0x8D;
Oled.EXTERNAL_VCC = false;
Oled.MEMORY_MODE = 0x20;
Oled.SEG_REMAP = 0xA1;
Oled.COM_SCAN_DEC = 0xC8;
Oled.COM_SCAN_INC = 0xC0;
Oled.SET_COM_PINS = 0xDA;
Oled.SET_CONTRAST = 0x81;
Oled.SET_PRECHARGE = 0xd9;
Oled.SET_VCOM_DETECT = 0xDB;
Oled.DISPLAY_ALL_ON_RESUME = 0xA4;
Oled.NORMAL_DISPLAY = 0xA6;
Oled.INVERT_DISPLAY = 0xA7;
Oled.COLUMN_ADDR = 0x21;
Oled.PAGE_ADDR = 0x22;
Oled.ACTIVATE_SCROLL = 0x2F;
Oled.DEACTIVATE_SCROLL = 0x2E;
Oled.SET_VERTICAL_SCROLL_AREA = 0xA3;
Oled.RIGHT_HORIZONTAL_SCROLL = 0x26;
Oled.LEFT_HORIZONTAL_SCROLL = 0x27;
Oled.VERTICAL_AND_RIGHT_HORIZONTAL_SCROLL = 0x29;
Oled.VERTICAL_AND_LEFT_HORIZONTAL_SCROLL = 0x2A;
