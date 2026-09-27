import { wildcard } from "./minecraft-server";

/**
 * Respostas das telas nos testes: com `formHooks.show` definido, `form.show()` devolve o que ele retornar
 * (tipo da tela: "action", "message" ou "modal"); sem ele, devolve um coringa como os demais mocks.
 */
export const formHooks: { show?: (kind: string, form?: RecordedForm) => unknown } = {};

/**
 * Frente msd-fase1: com `formRecording.enabled`, cada tela guarda as chamadas (title, body, button...) e o `show`
 * recebe o registro como 2º argumento (os testes leem os botões da tela que está sendo mostrada).
 */
export interface RecordedForm { kind: string; calls: [string, unknown[]][] }
export const formRecording: { enabled: boolean; forms: RecordedForm[] } = { enabled: false, forms: [] };

/** Tela encadeável (title/body/button... devolvem a própria tela). */
function formMock(kind: string): any {
	return new Proxy(Object.assign(function () { }, { prototype: {} }), {
		get: (target, prop) => (prop in target ? (target as any)[prop] : wildcard()),
		construct: () => {
			const record: RecordedForm = { kind, calls: [] };
			if (formRecording.enabled) formRecording.forms.push(record);
			const form: any = new Proxy({}, {
				get: (_target, prop) => {
					if (prop === "then") return undefined;
					if (prop === "show") return () => (formHooks.show ? Promise.resolve(formHooks.show(kind, record)) : wildcard());
					return (...args: unknown[]) => {
						if (formRecording.enabled) record.calls.push([String(prop), args]);
						return form;
					};
				},
			});
			return form;
		},
	});
}

export const ActionFormData = formMock("action");
export const MessageFormData = formMock("message");
export const ModalFormData = formMock("modal");
// DDUI estável (server-ui 2.2.0).
export const CustomForm = wildcard({ prototype: {} });
export const MessageBox = wildcard({ prototype: {} });
export const ObservableBoolean = wildcard({ prototype: {} });
export const ObservableNumber = wildcard({ prototype: {} });
export const ObservableString = wildcard({ prototype: {} });
export const ObservableUIRawMessage = wildcard({ prototype: {} });
export const UIManager = wildcard({ prototype: {} });
// Usados pela tela de batalha (frente batalhas).
export const uiManager = wildcard();
export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" };
