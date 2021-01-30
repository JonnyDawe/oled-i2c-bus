interface OledOptions {
  height?: number,
  width?: number,
  address?: number,
  lineSpacing?: number,
  letterSpacing?: number
  ssdType?: "ssd1306" | "ssd1305"
  screenConfig?: ScreenConfig
  data?: number
  command?: number
}

interface textCursor {
  x: number,
  y: number
}

interface ScreenConfig {
  multiplex: number
  compins: number
  coloffset: number
}

interface Font {
  monospace: boolean
  width: number
  height: number
  fontData: number[]
  lookup: string[]
}


type Black = 0x00
type White = 0x01 | 0xff
type Color = Black | White
type Direction = 'left' | 'left diagonal' | 'right' | 'right diagonal'
type Pixel = [number, number, Color]


enum TransferType { Command, Data }


export = class Oled {


  //OLED Config
  private readonly HEIGHT: number;
  private readonly WIDTH: number;
  private readonly ADDRESS: number;
  private readonly PROTOCOL: string = 'I2C';
  private readonly LINESPACING: number;
  private readonly LETTERSPACING: number;
  private readonly ssdType: "ssd1306" | "ssd1305";

  private readonly DATA: number;
  private readonly COMMAND: number;

  // command buffers --------------------
  private static readonly DISPLAY_OFF = 0xAE;
  private static readonly DISPLAY_ON = 0xAF;
  private static readonly SET_DISPLAY_CLOCK_DIV = 0xD5;
  private static readonly SET_MULTIPLEX = 0xA8;
  private static readonly SET_DISPLAY_OFFSET = 0xD3;
  private static readonly SET_START_LINE = 0x00;
  private static readonly CHARGE_PUMP = 0x8D;
  private static readonly EXTERNAL_VCC = false;
  private static readonly MEMORY_MODE = 0x20;
  private static readonly SEG_REMAP = 0xA1; // using 0xA0 will flip screen
  private static readonly COM_SCAN_DEC = 0xC8;
  private static readonly COM_SCAN_INC = 0xC0;
  private static readonly SET_COM_PINS = 0xDA;
  private static readonly SET_CONTRAST = 0x81;
  private static readonly SET_PRECHARGE = 0xd9;
  private static readonly SET_VCOM_DETECT = 0xDB;
  private static readonly DISPLAY_ALL_ON_RESUME = 0xA4;
  private static readonly NORMAL_DISPLAY = 0xA6;
  private static readonly COLUMN_ADDR = 0x21;
  private static readonly PAGE_ADDR = 0x22;
  private static readonly INVERT_DISPLAY = 0xA7;
  private static readonly ACTIVATE_SCROLL = 0x2F;
  private static readonly DEACTIVATE_SCROLL = 0x2E;
  private static readonly SET_VERTICAL_SCROLL_AREA = 0xA3;
  private static readonly RIGHT_HORIZONTAL_SCROLL = 0x26;
  private static readonly LEFT_HORIZONTAL_SCROLL = 0x27;
  private static readonly VERTICAL_AND_RIGHT_HORIZONTAL_SCROLL = 0x29;
  private static readonly VERTICAL_AND_LEFT_HORIZONTAL_SCROLL = 0x2A;

  // Text string cursor starting position:
  private _textCursor: textCursor = { x: 0, y: 0 }
  set textCursor(position: textCursor) {
    this._textCursor = position
  }
  get textCursor(): textCursor {
    return this._textCursor
  }

  // Initialise
  private buffer: Buffer
  private dirtyBytes: number[];
  private wire: any //i2c
  private screenConfig: ScreenConfig



  public constructor(i2c: any, opts: OledOptions) {
    this.HEIGHT = opts.height || 32;
    this.WIDTH = opts.width || 128;
    this.ADDRESS = opts.address || 0x3C;
    this.LINESPACING = opts.lineSpacing ? opts.lineSpacing : 2;
    this.LETTERSPACING = opts.letterSpacing ? opts.letterSpacing : 1;
    this.ssdType = opts.ssdType ? opts.ssdType : "ssd1306"

    this.DATA = opts.data || 0x40
    this.COMMAND = opts.command || 0x00


    // new blank buffer
    this.buffer = Buffer.alloc((this.WIDTH * this.HEIGHT) / 8)
    this.buffer.fill(0x00)
    this.dirtyBytes = []



    const config: any = {
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
    }
    //i2c Setup
    this.wire = i2c;

    const screenSize = `${this.WIDTH}x${this.HEIGHT}`
    this.screenConfig = opts.screenConfig ? opts.screenConfig : config[this.ssdType][screenSize]
    console.log("the screen config is", this.screenConfig)
    this._initialise()
  }


  private _initialise(): void {
    // sequence of bytes to initialise with
    const initSeq = [
      Oled.DISPLAY_OFF,
      Oled.SET_DISPLAY_CLOCK_DIV, 0x80,
      Oled.SET_MULTIPLEX, this.screenConfig.multiplex, // set the last value dynamically based on screen size requirement
      Oled.SET_DISPLAY_OFFSET, 0x00, // sets offset pro to 0
      Oled.SET_START_LINE,
      Oled.CHARGE_PUMP, 0x14, // charge pump val
      Oled.MEMORY_MODE, 0x00, // 0x0 act like ks0108
      Oled.SEG_REMAP, // screen orientation
      Oled.COM_SCAN_DEC, // screen orientation change to INC to flip
      Oled.SET_COM_PINS, this.screenConfig.compins, // com pins val sets dynamically to match each screen size requirement
      Oled.SET_CONTRAST, 0x8F, // contrast val
      Oled.SET_PRECHARGE, 0xF1, // precharge val
      Oled.SET_VCOM_DETECT, 0x40, // vcom detect
      Oled.DISPLAY_ALL_ON_RESUME,
      Oled.NORMAL_DISPLAY,
      Oled.DISPLAY_ON
    ];

    // write init seq commands
    for (let i = 0; i < initSeq.length; i++) {
      this._transfer(TransferType.Command, initSeq[i])
    }

  }

  // writes both commands and data buffers to this device
  private _transfer(type: TransferType, val: number, callback?: () => void): void {
    let control: number

    if (type === TransferType.Data) {
      control = this.DATA
    } else if (type === TransferType.Command) {
      control = this.COMMAND
    } else {
      return
    }



    const bufferForSend = Buffer.from([control, val])
    const sentCount = this.wire.i2cWriteSync(this.ADDRESS, 2, bufferForSend);

    if (callback) {
      callback()
    }
  }



  private _readI2C(callback: (data: number) => void): void {
    let data = [0]

    // the Buffer instance that the data will be written to.
    let buff = Buffer.from(data)
    this.wire.i2cReadSync(this.ADDRESS, 1, buff);
    callback(buff[0])
  }


  //rewrite as function!!!!!!!!!!!!!!!!!!!!
  // sometimes the oled gets a bit busy with lots of bytes.
  // Read the response byte to see if this is the case
  private _waitUntilReady = (callback: () => void) => {

    //tick is a variable set to a function with the callback already included...
    const tick = (callback: () => void) => {
      this._readI2C((byte: number) => {
        // read the busy byte in the response
        const busy = byte >> 7 & 1
        if (!busy) {
          // if not busy, it's ready for callback
          callback()
        } else {
          console.log('I\'m busy!')
          setTimeout(tick, 0)
        }
      })
    }

    setTimeout(function () { tick(callback) }, 0);
  }


  private _invertColor(color: Color): Color {
    return (color === 0) ? 1 : 0
  }



  // write text to the oled
  public writeString(font: Font, size: number, string: string, color: Color, wrap: boolean, linespacing: number = this.LINESPACING, letterspacing: number = this.LETTERSPACING, sync?: boolean): void {
    const immed = (typeof sync === 'undefined') ? true : sync
    const wordArr = string.split(' ')

    const len = wordArr.length

    // start x offset at cursor pos
    let offset = this.textCursor.x
    let padding = 0

    const letspace = letterspacing
    const leading = linespacing

    // loop through words
    for (let i = 0; i < len; i += 1) {
      // put the word space back in for all in between words or empty words
      if (i < len - 1) {
        wordArr[i] += ' ';
      }

      const stringArr = wordArr[i].split('')
      const slen = stringArr.length
      const compare = (font.width * size * slen) + (size * (len - 1))

      // wrap words if necessary
      if (wrap && len > 1 && (offset >= (this.WIDTH - compare))) {
        offset = 1

        //Set the text cursor to a new value
        this.textCursor = {
          x: offset,
          y: this._textCursor.y + (font.height * size) + size + leading
        }
      }

      // loop through the array of each char to draw
      for (let i = 0; i < slen; i += 1) {
        // look up the position of the char, pull out the buffer slice
        const charBuf = this._findCharBuf(font, stringArr[i])
        // read the bits in the bytes that make up the char
        const charBytes = this._readCharBytes(charBuf)
        // draw the entire charactei
        this._drawChar(font, charBytes, size, color, false)

        // fills in background behind the text pixels so that it's easier to read the text
        this.fillRect(offset - padding, this._textCursor.y, padding, (font.height * size), this._invertColor(color), false)

        // calc new x position for the next char, add a touch of padding too if it's a non space char
        padding = (stringArr[i] === ' ') ? 0 : size + letspace
        offset += (font.width * size) + padding


        // wrap letters if necessary
        if (wrap && (offset >= (this.WIDTH - font.width - letspace))) {
          offset = 1
          this._textCursor.y += (font.height * size) + size + leading
        }
        // set the 'cursor' for the next char to be drawn, then loop again for next char
        this.textCursor = {
          x: offset,
          y: this._textCursor.y
        }
      }
    }
    if (immed) {
      this._updateDirtyBytes(this.dirtyBytes)
    }
  }




  // draw an individual character to the screen
  private _drawChar(font: Font, byteArray: number[][], size: number, color: Color, sync?: boolean): void {
    // take your positions...
    const x = this._textCursor.x
    const y = this._textCursor.y

    let c = 0
    let pagePos = 0

    // loop through the byte array containing the hexes for the char
    for (let i = 0; i < byteArray.length; i += 1) {
      pagePos = Math.floor(i / font.width) * 8
      for (let j = 0; j < 8; j += 1) {
        // pull color out (invert the color if user chose black)
        const pixelState = (byteArray[i][j] === 1) ? color : this._invertColor(color);
        let xpos
        let ypos
        // standard font size
        if (size === 1) {
          xpos = x + c
          ypos = y + j + pagePos
          this.drawPixel([xpos, ypos, pixelState], false)
        } else {
          // MATH! Calculating pixel size multiplier to primitively scale the font
          xpos = x + (i * size)
          ypos = y + (j * size)
          this.fillRect(xpos, ypos, size, size, pixelState, false)
        }
      }
      c = (c < font.width - 1) ? c += 1 : 0
    }
  }


  // get character bytes from the supplied font object in order to send to framebuffer
  private _readCharBytes(byteArray: number[]): number[][] {
    let bitArr = []
    const bitCharArr = []
    // loop through each byte supplied for a char
    for (let i = 0; i < byteArray.length; i += 1) {
      // set current byte
      const byte = byteArray[i]
      // read each byte
      for (let j = 0; j < 8; j += 1) {
        // shift bits right until all are read
        const bit = byte >> j & 1
        bitArr.push(bit)
      }
      // push to array containing flattened bit sequence
      bitCharArr.push(bitArr)
      // clear bits for next byte
      bitArr = []
    }

    return bitCharArr
  }


  // find where the character exists within the font object
  private _findCharBuf(font: Font, c: string): number[] {
    const charLength = Math.ceil((font.width * font.height) / 8)
    // use the lookup array as a ref to find where the current char bytes start
    const cBufPos = font.lookup.indexOf(c) * charLength
    // slice just the current char's bytes out of the fontData array and return
    return font.fontData.slice(cBufPos, cBufPos + charLength)
  }



  // send the entire framebuffer to the oled
  public update(): void {
    // wait for oled to be ready
    this._waitUntilReady(() => {
      // set the start and endbyte locations for oled display update
      const displaySeq = [
        Oled.COLUMN_ADDR,
        this.screenConfig.coloffset,
        this.screenConfig.coloffset + this.WIDTH - 1, // column start and end address
        Oled.PAGE_ADDR, 0, (this.HEIGHT / 8) - 1 // page start and end address
      ]

      const displaySeqLen = displaySeq.length
      const bufferLen = this.buffer.length

      // send intro seq
      for (let i = 0; i < displaySeqLen; i += 1) {
        this._transfer(TransferType.Command, displaySeq[i])
      }

      // write buffer data
      // for (let i = 0; i < bufferLen; i += 1) {
      //   this._transfer(TransferType.Data, this.buffer[i])
      // }

      //write buffer data
      const bufferToSend = Buffer.concat([Buffer.from([0x40]), this.buffer]);
      const sentCount = this.wire.i2cWriteSync(this.ADDRESS, bufferToSend.length, bufferToSend);


    })

    // now that all bytes are synced, reset dirty state
    this.dirtyBytes = []
  }


  // send dim display command to oled
  public dimDisplay(bool: boolean): void {
    let contrast: number

    if (bool) {
      contrast = 0 // Dimmed display
    } else {
      contrast = 0xCF // Bright display
    }

    this._transfer(TransferType.Command, Oled.SET_CONTRAST)
    this._transfer(TransferType.Command, contrast)
  }


  // turn oled off
  public turnOffDisplay(): void {
    this._transfer(TransferType.Command, Oled.DISPLAY_OFF)
  }

  // turn oled on
  public turnOnDisplay(): void {
    this._transfer(TransferType.Command, Oled.DISPLAY_ON)
  }


  // clear all pixels currently on the display
  public clearDisplay(sync?: boolean): void {
    const immed = (typeof sync === 'undefined') ? true : sync
    // write off pixels
    for (let i = 0; i < this.buffer.length; i += 1) {
      if (this.buffer[i] !== 0x00) {
        this.buffer[i] = 0x00
        if (this.dirtyBytes.indexOf(i) === -1) {
          this.dirtyBytes.push(i)
        }
      }
    }

    if (immed) {
      this._updateDirtyBytes(this.dirtyBytes)
    }
  }


  // invert pixels on oled
  public invertDisplay(bool: boolean): void {
    if (bool) {
      this._transfer(TransferType.Command, Oled.INVERT_DISPLAY) // inverted
    } else {
      this._transfer(TransferType.Command, Oled.NORMAL_DISPLAY) // non inverted
    }
  }



  private _isSinglePixel(pixels: Pixel | Pixel[]): pixels is Pixel {
    return typeof pixels[0] !== 'object'
  }


  // draw one or many pixels on oled
  public drawPixel(pixels: Pixel | Pixel[], sync?: boolean): void {
    const immed = (typeof sync === 'undefined') ? true : sync

    // handle lazy single pixel case
    if (this._isSinglePixel(pixels)) pixels = [pixels]

    pixels.forEach((el: Pixel) => {
      // return if the pixel is out of range
      const [x, y, color] = el

      if (x > this.WIDTH || y > this.HEIGHT) return

      // thanks, Martin Richards.
      // I wanna can this, this tool is for devs who get 0 indexes
      // x -= 1; y -=1;
      let byte = 0

      const page = Math.floor(y / 8)
      const pageShift = 0x01 << (y - 8 * page);

      // is the pixel on the first row of the page?
      (page === 0) ? byte = x : byte = x + (this.WIDTH * page)

      // colors! Well, monochrome.
      if (color === 0) {
        // BLACK pixel
        this.buffer[byte] &= ~pageShift
      } else {
        // WHITE pixel
        this.buffer[byte] |= pageShift
      }

      // push byte to dirty if not already there
      if (this.dirtyBytes.indexOf(byte) === -1) {
        this.dirtyBytes.push(byte)
      }
    }, this)

    if (immed) {
      this._updateDirtyBytes(this.dirtyBytes)
    }
  }


  // looks at dirty bytes, and sends the updated bytes to the display
  private _updateDirtyBytes(byteArray: number[]): void {
    const blen = byteArray.length

    // check to see if this will even save time
    if (blen > (this.buffer.length / 7)) {
      // just call regular update at this stage, saves on bytes sent
      this.update();
      // now that all bytes are synced, reset dirty state
      this.dirtyBytes = [];
      return
    }

    this._waitUntilReady(() => {
      let pageStart = Infinity
      let pageEnd = 0
      let colStart = Infinity
      let colEnd = 0
      let any = false

      // iterate through dirty bytes
      for (let i = 0; i < blen; i += 1) {
        const b = byteArray[i]
        if ((b >= 0) && (b < this.buffer.length)) {
          const page = b / this.WIDTH | 0
          if (page < pageStart) pageStart = page
          if (page > pageEnd) pageEnd = page
          const col = b % this.WIDTH
          if (col < colStart) colStart = col
          if (col > colEnd) colEnd = col
          any = true
        }
      }

      if (!any) return

      const displaySeq = [
        Oled.COLUMN_ADDR, colStart, colEnd, // column start and end address
        Oled.PAGE_ADDR, pageStart, pageEnd // page start and end address
      ]

      const displaySeqLen = displaySeq.length

      // send intro seq
      for (let i = 0; i < displaySeqLen; i += 1) {
        this._transfer(TransferType.Command, displaySeq[i])
      }

      // send byte, then move on to next byte
      for (let i = pageStart; i <= pageEnd; i += 1) {
        for (let j = colStart; j <= colEnd; j += 1) {
          this._transfer(TransferType.Data, this.buffer[this.WIDTH * i + j])
        }
      }
    })

    // now that all bytes are synced, reset dirty state
    this.dirtyBytes = []
  }



  // using Bresenham's line algorithm
  public drawLine(x0: number, y0: number, x1: number, y1: number, color: Color, sync?: boolean): void {
    const immed = (typeof sync === 'undefined') ? true : sync

    const dx = Math.abs(x1 - x0)
    const sx = x0 < x1 ? 1 : -1
    const dy = Math.abs(y1 - y0)
    const sy = y0 < y1 ? 1 : -1

    let err = (dx > dy ? dx : -dy) / 2

    while (true) {
      this.drawPixel([x0, y0, color], false)

      if (x0 === x1 && y0 === y1) break

      const e2 = err

      if (e2 > -dx) { err -= dy; x0 += sx }
      if (e2 < dy) { err += dx; y0 += sy }
    }

    if (immed) {
      this._updateDirtyBytes(this.dirtyBytes)
    }
  }

  // Draw an outlined  rectangle
  public drawRect(x: number, y: number, w: number, h: number, color: Color, sync?: boolean): void {
    const immed = (typeof sync === 'undefined') ? true : sync
    // top
    this.drawLine(x, y, x + w, y, color, false)

    // left
    this.drawLine(x, y + 1, x, y + h - 1, color, false)

    // right
    this.drawLine(x + w, y + 1, x + w, y + h - 1, color, false)

    // bottom
    this.drawLine(x, y + h - 1, x + w, y + h - 1, color, false)

    if (immed) {
      this._updateDirtyBytes(this.dirtyBytes)
    }
  };

  // draw a filled rectangle on the oled
  public fillRect(x: number, y: number, w: number, h: number, color: Color, sync?: boolean): void {
    const immed = (typeof sync === 'undefined') ? true : sync
    // one iteration for each column of the rectangle
    for (let i = x; i < x + w; i += 1) {
      // draws a vert line
      this.drawLine(i, y, i, y + h - 1, color, false)
    }
    if (immed) {
      this._updateDirtyBytes(this.dirtyBytes)
    }
  }

  /**
   * Draw a circle outline
   *
   * This method is ad verbatim translation from the corresponding
   * method on the Adafruit GFX library
   * https://github.com/adafruit/Adafruit-GFX-Library
   */
  public drawCircle(x0: number, y0: number, r: number, color: Color, sync?: boolean): void {
    const immed = (typeof sync === 'undefined') ? true : sync

    let f = 1 - r
    let ddF_x = 1
    let ddF_y = -2 * r
    let x = 0
    let y = r

    this.drawPixel(
      [[x0, y0 + r, color],
      [x0, y0 - r, color],
      [x0 + r, y0, color],
      [x0 - r, y0, color]],
      false
    )

    while (x < y) {
      if (f >= 0) {
        y--
        ddF_y += 2
        f += ddF_y
      }
      x++
      ddF_x += 2
      f += ddF_x

      this.drawPixel(
        [[x0 + x, y0 + y, color],
        [x0 - x, y0 + y, color],
        [x0 + x, y0 - y, color],
        [x0 - x, y0 - y, color],
        [x0 + y, y0 + x, color],
        [x0 - y, y0 + x, color],
        [x0 + y, y0 - x, color],
        [x0 - y, y0 - x, color]],
        false
      )
    }

    if (immed) {
      this._updateDirtyBytes(this.dirtyBytes)
    }
  };

  // activate scrolling for rows start through stop
  public startScroll(dir: Direction, start: number, stop: number): void {
    const cmdSeq: number[] = []

    switch (dir) {
      case 'right':
        cmdSeq.push(Oled.RIGHT_HORIZONTAL_SCROLL); break
      case 'left':
        cmdSeq.push(Oled.LEFT_HORIZONTAL_SCROLL); break
      case 'left diagonal':
        cmdSeq.push(
          Oled.SET_VERTICAL_SCROLL_AREA,
          0x00,
          this.HEIGHT,
          Oled.VERTICAL_AND_LEFT_HORIZONTAL_SCROLL,
          0x00,
          start,
          0x00,
          stop,
          0x01,
          Oled.ACTIVATE_SCROLL
        )
        break
      case 'right diagonal':
        cmdSeq.push(
          Oled.SET_VERTICAL_SCROLL_AREA,
          0x00,
          this.HEIGHT,
          Oled.VERTICAL_AND_RIGHT_HORIZONTAL_SCROLL,
          0x00,
          start,
          0x00,
          stop,
          0x01,
          Oled.ACTIVATE_SCROLL
        )
        break
    }

    this._waitUntilReady(() => {
      if (dir === 'right' || dir === 'left') {
        cmdSeq.push(
          0x00, start,
          0x00, stop,
          0x00, 0xFF,
          Oled.ACTIVATE_SCROLL
        )
      }

      for (let i = 0; i < cmdSeq.length; i += 1) {
        this._transfer(TransferType.Command, cmdSeq[i])
      }
    })
  }

  // stop scrolling display contents
  public stopScroll() {
    this._transfer(TransferType.Command, Oled.DEACTIVATE_SCROLL) // stahp
  }













}