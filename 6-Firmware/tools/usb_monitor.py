import serial
import time
import sys
import glob
import threading

BAUD = 115200

def find_port():
    ports = glob.glob("/dev/ttyACM*")
    return ports[0] if ports else None

def read_serial(ser):
    while True:
        try:
            line = ser.readline()
            if line:
                print(line.decode(errors="ignore").rstrip())
        except serial.SerialException:
            print("\nDisconnesso. Attendo riconnessione...\n")
            ser.close()
            break
        except Exception as e:
            print(f"Errore lettura seriale: {e}")
            break

def write_serial(ser):
    while True:
        try:
            cmd = input()
            if cmd.lower() == "exit":
                print("Uscita richiesta dall'utente.")
                ser.close()
                sys.exit(0)
            ser.write((cmd + "\n").encode())
        except serial.SerialException:
            print("\nDisconnesso. Non posso inviare comandi.\n")
            break
        except Exception as e:
            print(f"Errore invio seriale: {e}")
            break

print("Monitor seriale USB (ESP32-S3)")
print("Ctrl+C per uscire\n")

while True:
    try:
        port = find_port()
        if not port:
            print("Nessuna porta trovata, attendo...")
            time.sleep(1)
            continue

        print(f"Tento di aprire {port}...")
        ser = serial.Serial(port, BAUD, timeout=1)
        time.sleep(2)
        print("Connesso.\n")
        
        t_read = threading.Thread(target=read_serial, args=(ser,), daemon=True)
        t_write = threading.Thread(target=write_serial, args=(ser,), daemon=True)
        t_read.start()
        t_write.start()
        
        while t_read.is_alive() and t_write.is_alive():
            time.sleep(0.1)

    # except KeyboardInterrupt:
    #     print("\nUscita richiesta dall'utente.")
    #     sys.exit(0)

    except Exception as e:
        print(f"Errore: {e}")
        time.sleep(1)
