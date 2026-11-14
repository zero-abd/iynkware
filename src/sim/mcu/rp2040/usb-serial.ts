import type { RP2040, USBCDC } from "rp2040js";
import type { Rp2040js } from "./lib.ts";

const QUEUE_CAP = 4096;

export interface UsbSerial {
  /** True once the firmware has enumerated as a serial device and the host side has raised DTR. */
  readonly connected: boolean;
  write(bytes: readonly number[]): void;
}

/**
 * The USB host the chip sees: it enumerates a CDC serial device and carries its bytes both ways. A request to read
 * from the device with nothing to send is left unanswered, as a real host's NAK would: rp2040js answers it with an
 * empty packet, which makes the firmware re-arm the endpoint at once and raise the USB interrupt about 35,000 times a
 * second, so an idle MicroPython never sleeps.
 */
export function attachUsbSerial(lib: Rp2040js, mcu: RP2040, onBytes: (bytes: Uint8Array) => void): UsbSerial {
  const cdc: USBCDC = new lib.USBCDC(mcu.usbCtrl);
  const usb = mcu.usbCtrl;
  const queue: number[] = [];
  let waiting: { endpoint: number; size: number } | null = null;
  let connected = false;
  // The endpoint number is only kept in a private field of USBCDC, and the descriptors that fill it are read by that class.
  const outEndpoint = (): number => (cdc as unknown as { outEndpoint: number }).outEndpoint;

  const send = (endpoint: number, size: number): void => {
    usb.endpointReadDone(endpoint, Uint8Array.from(queue.splice(0, Math.min(size, queue.length))));
  };

  cdc.onSerialData = onBytes;
  cdc.onDeviceConnected = () => {
    connected = true;
  };
  usb.onEndpointRead = (endpoint, size) => {
    if (endpoint !== outEndpoint()) return;
    if (queue.length === 0) waiting = { endpoint, size };
    else send(endpoint, size);
  };

  return {
    get connected() {
      return connected;
    },
    write(bytes) {
      for (const byte of bytes) if (queue.length < QUEUE_CAP) queue.push(byte);
      if (waiting && queue.length > 0) {
        const { endpoint, size } = waiting;
        waiting = null;
        send(endpoint, size);
      }
    },
  };
}
