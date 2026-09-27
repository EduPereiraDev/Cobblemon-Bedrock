// NBT: leitura do formato Java (big-endian, gzip) e escrita do formato Bedrock (little-endian, sem
// compressão) usado nos arquivos .mcstructure.
import { gunzipSync } from "node:zlib";

export const TAG = { End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6, ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12 } as const;

/** Valor NBT lido: números viram number (Long vira bigint), compostos viram objetos, listas viram arrays. */
export type NbtValue = number | bigint | string | NbtValue[] | { [k: string]: NbtValue } | Int8Array | Int32Array | BigInt64Array;

/** Lê um arquivo NBT do Java (gzip opcional). Devolve o composto raiz. */
export function readJavaNbt(buffer: Buffer): Record<string, NbtValue> {
	const data = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
	let pos = 0;
	const u8 = () => data.readUInt8(pos++);
	const i8 = () => data.readInt8(pos++);
	const i16 = () => { const v = data.readInt16BE(pos); pos += 2; return v; };
	const u16 = () => { const v = data.readUInt16BE(pos); pos += 2; return v; };
	const i32 = () => { const v = data.readInt32BE(pos); pos += 4; return v; };
	const i64 = () => { const v = data.readBigInt64BE(pos); pos += 8; return v; };
	const f32 = () => { const v = data.readFloatBE(pos); pos += 4; return v; };
	const f64 = () => { const v = data.readDoubleBE(pos); pos += 8; return v; };
	const str = () => { const n = u16(); const s = data.toString("utf8", pos, pos + n); pos += n; return s; };
	const payload = (type: number): NbtValue => {
		switch (type) {
			case TAG.Byte: return i8();
			case TAG.Short: return i16();
			case TAG.Int: return i32();
			case TAG.Long: return i64();
			case TAG.Float: return f32();
			case TAG.Double: return f64();
			case TAG.ByteArray: { const n = i32(); const a = new Int8Array(n); for (let i = 0; i < n; i++) a[i] = i8(); return a; }
			case TAG.String: return str();
			case TAG.List: { const t = u8(); const n = i32(); const out: NbtValue[] = []; for (let i = 0; i < n; i++) out.push(payload(t)); return out; }
			case TAG.Compound: {
				const out: Record<string, NbtValue> = {};
				for (;;) {
					const t = u8();
					if (t === TAG.End) return out;
					const name = str();
					out[name] = payload(t);
				}
			}
			case TAG.IntArray: { const n = i32(); const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = i32(); return a; }
			case TAG.LongArray: { const n = i32(); const a = new BigInt64Array(n); for (let i = 0; i < n; i++) a[i] = i64(); return a; }
			default: throw new Error(`tag NBT desconhecida ${type} em ${pos}`);
		}
	};
	const rootType = u8();
	if (rootType !== TAG.Compound) throw new Error("NBT sem composto raiz");
	str();
	return payload(TAG.Compound) as Record<string, NbtValue>;
}

/** Valor tipado para a escrita (o Bedrock exige o tipo exato de cada campo). */
export type NbtTyped =
	| { type: "byte" | "short" | "int" | "float" | "double"; value: number }
	| { type: "long"; value: bigint }
	| { type: "string"; value: string }
	| { type: "list"; itemType: NbtTypeName; value: NbtTyped[] }
	| { type: "compound"; value: Record<string, NbtTyped> };
export type NbtTypeName = NbtTyped["type"] | "end";

const TYPE_ID: Record<NbtTypeName, number> = { end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, string: 8, list: 9, compound: 10 };

export const nbt = {
	byte: (value: number): NbtTyped => ({ type: "byte", value }),
	short: (value: number): NbtTyped => ({ type: "short", value }),
	int: (value: number): NbtTyped => ({ type: "int", value }),
	long: (value: bigint): NbtTyped => ({ type: "long", value }),
	float: (value: number): NbtTyped => ({ type: "float", value }),
	string: (value: string): NbtTyped => ({ type: "string", value }),
	list: (itemType: NbtTypeName, value: NbtTyped[]): NbtTyped => ({ type: "list", itemType: value.length ? itemType : "end", value }),
	compound: (value: Record<string, NbtTyped>): NbtTyped => ({ type: "compound", value }),
};

/** Escreve NBT little-endian (Bedrock, sem compressão) com o composto raiz sem nome. */
export function writeBedrockNbt(root: Record<string, NbtTyped>): Buffer {
	const chunks: Buffer[] = [];
	let size = 0;
	const push = (b: Buffer) => { chunks.push(b); size += b.length; };
	const u8 = (v: number) => { const b = Buffer.alloc(1); b.writeUInt8(v); push(b); };
	const i8 = (v: number) => { const b = Buffer.alloc(1); b.writeInt8(v); push(b); };
	const i16 = (v: number) => { const b = Buffer.alloc(2); b.writeInt16LE(v); push(b); };
	const i32 = (v: number) => { const b = Buffer.alloc(4); b.writeInt32LE(v); push(b); };
	const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); push(b); };
	const f32 = (v: number) => { const b = Buffer.alloc(4); b.writeFloatLE(v); push(b); };
	const f64 = (v: number) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); push(b); };
	const str = (s: string) => { const b = Buffer.from(s, "utf8"); const n = Buffer.alloc(2); n.writeUInt16LE(b.length); push(n); push(b); };
	const payload = (t: NbtTyped) => {
		switch (t.type) {
			case "byte": i8(t.value); break;
			case "short": i16(t.value); break;
			case "int": i32(t.value); break;
			case "long": i64(t.value); break;
			case "float": f32(t.value); break;
			case "double": f64(t.value); break;
			case "string": str(t.value); break;
			case "list": u8(TYPE_ID[t.itemType]); i32(t.value.length); for (const x of t.value) payload(x); break;
			case "compound":
				for (const [k, v] of Object.entries(t.value)) { u8(TYPE_ID[v.type]); str(k); payload(v); }
				u8(0);
				break;
		}
	};
	u8(TAG.Compound);
	str("");
	payload({ type: "compound", value: root });
	return Buffer.concat(chunks, size);
}

/** Lê NBT little-endian do Bedrock (para os testes conferirem o .mcstructure gerado). */
export function readBedrockNbt(data: Buffer): Record<string, NbtValue> {
	let pos = 0;
	const u8 = () => data.readUInt8(pos++);
	const str = () => { const n = data.readUInt16LE(pos); pos += 2; const s = data.toString("utf8", pos, pos + n); pos += n; return s; };
	const payload = (type: number): NbtValue => {
		switch (type) {
			case TAG.Byte: return data.readInt8(pos++);
			case TAG.Short: { const v = data.readInt16LE(pos); pos += 2; return v; }
			case TAG.Int: { const v = data.readInt32LE(pos); pos += 4; return v; }
			case TAG.Long: { const v = data.readBigInt64LE(pos); pos += 8; return v; }
			case TAG.Float: { const v = data.readFloatLE(pos); pos += 4; return v; }
			case TAG.Double: { const v = data.readDoubleLE(pos); pos += 8; return v; }
			case TAG.String: return str();
			case TAG.List: { const t = u8(); const n = data.readInt32LE(pos); pos += 4; const out: NbtValue[] = []; for (let i = 0; i < n; i++) out.push(payload(t)); return out; }
			case TAG.Compound: {
				const out: Record<string, NbtValue> = {};
				for (;;) {
					const t = u8();
					if (t === TAG.End) return out;
					const name = str();
					out[name] = payload(t);
				}
			}
			default: throw new Error(`tag NBT não suportada ${type}`);
		}
	};
	if (u8() !== TAG.Compound) throw new Error("NBT sem composto raiz");
	str();
	return payload(TAG.Compound) as Record<string, NbtValue>;
}
