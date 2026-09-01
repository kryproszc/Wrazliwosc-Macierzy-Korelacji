import { Check } from "lucide-react";

type EntitySuccessModalProps = {
	isOpen: boolean;
	heading: string;
	detailsMessage: string;
	onClose: () => void;
};

export function EntitySuccessModal({
	isOpen,
	heading,
	detailsMessage,
	onClose,
}: EntitySuccessModalProps) {
	if (!isOpen) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-60 flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Zamknij komunikat sukcesu"
				className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]"
				onClick={onClose}
			/>

			<div
				role="dialog"
				aria-modal="true"
				aria-label={heading}
				className="relative z-10 w-full max-w-xl rounded-2xl bg-linear-to-br from-[#1a2f53] via-[#162949] to-[#132340] p-4 text-slate-100 shadow-[0_14px_36px_rgba(2,8,23,0.32)] sm:p-5"
			>
				<div className="flex items-start gap-3 rounded-xl bg-transparent p-4">
					<span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_8px_18px_rgba(16,185,129,0.35)]">
						<Check size={20} />
					</span>
					<div className="min-w-0 flex-1">
						<p className="font-semibold text-emerald-300 text-xs uppercase tracking-[0.12em]">
							Operacja zakończona
						</p>
						<h3 className="mt-1 font-bold text-3xl text-white leading-tight">
							{heading}
						</h3>
						{detailsMessage.trim() ? (
							<p className="mt-2 text-slate-200 text-sm">{detailsMessage}</p>
						) : null}

						<div className="mt-4 flex justify-end">
							<button
								type="button"
								onClick={onClose}
								className="inline-flex h-10 items-center rounded-lg border border-[#6ea3f0] bg-[#345689] px-4 font-semibold text-sm text-white transition-colors hover:bg-[#3f659d]"
							>
								Zamknij
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
