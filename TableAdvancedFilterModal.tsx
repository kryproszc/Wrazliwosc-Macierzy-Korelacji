import { X } from "lucide-react";
import { DateInputWithCalendar } from "@/shared/components/forms/DateInputWithCalendar";
import { formatIsoDateForDisplay } from "@/shared/utils/date";

type Anchor = {
	top: number;
	left: number;
};

type TableAdvancedFilterModalProps = {
	isOpen: boolean;
	anchor: Anchor;
	columnLabel: string;
	searchValue: string;
	visibleValues: string[];
	selectedValues: string[];
	selectedDateRange?: { from: string; to: string } | null;
	onDateRangeChange?: (range: { from: string; to: string }) => void;
	isDateFilter?: boolean;
	isLoadingValues?: boolean;
	onClose: () => void;
	onSearchChange: (value: string) => void;
	onSelectAllVisible: () => void;
	onClearSelectedColumn: () => void;
	onToggleValue: (value: string) => void;
	onApplySearchValue?: (value: string) => void;
	onClearAllFilters: () => void;
	onValuesScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
};

export function TableAdvancedFilterModal({
	isOpen,
	anchor,
	columnLabel,
	searchValue,
	visibleValues,
	selectedValues,
	selectedDateRange,
	onDateRangeChange,
	isDateFilter,
	isLoadingValues,
	onClose,
	onSearchChange,
	onSelectAllVisible,
	onClearSelectedColumn,
	onToggleValue,
	onApplySearchValue,
	onClearAllFilters,
	onValuesScroll,
}: TableAdvancedFilterModalProps) {
	const isIsoDateValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
	const valuesForDateDetection = [...visibleValues, ...selectedValues].filter(
		(value) => value && value !== "(puste)",
	);
	const inferredDateFilter =
		valuesForDateDetection.length > 0 &&
		valuesForDateDetection.every((value) => isIsoDateValue(value));
	const isDateRangeMode =
		(isDateFilter ?? inferredDateFilter) && typeof onDateRangeChange === "function";
	const dateRangeFrom = selectedDateRange?.from ?? "";
	const dateRangeTo = selectedDateRange?.to ?? "";
	const trimmedSearchValue = searchValue.trim();
	const canApplySearchValue =
		typeof onApplySearchValue === "function" && trimmedSearchValue.length > 0;

	if (!isOpen) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-40">
			<button
				type="button"
				aria-label="Zamknij filtrowanie zaawansowane"
				className="absolute inset-0 bg-transparent"
				onClick={onClose}
			/>

			<div
				role="dialog"
				aria-modal="true"
				aria-label="Filtrowanie zaawansowane"
				className="absolute z-10 flex max-h-[calc(100vh-2rem)] w-85 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white p-3 text-slate-900 shadow-[0_20px_40px_rgba(2,8,23,0.28)]"
				style={{
					top: anchor.top,
					left: anchor.left,
				}}
				onClick={(event) => event.stopPropagation()}
			>
				<div className="mb-3 flex items-center justify-between gap-3 border-slate-200 border-b pb-2">
					<div>
						<h3 className="font-semibold text-slate-900 text-sm">Filtr: {columnLabel}</h3>
					</div>

					<button
						type="button"
						onClick={onClose}
						className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition-colors hover:bg-slate-100"
					>
						<X size={14} />
					</button>
				</div>

				<div className="min-h-0 flex flex-1 flex-col rounded-lg border border-slate-200 bg-white p-2.5">
					{isDateRangeMode ? (
						<div className="space-y-2">
							<DateInputWithCalendar
								label="Od"
								value={dateRangeFrom}
								onChange={(next) =>
									onDateRangeChange({
										from: next,
										to: dateRangeTo,
									})
								}
							/>

							<DateInputWithCalendar
								label="Do"
								value={dateRangeTo}
								onChange={(next) =>
									onDateRangeChange({
										from: dateRangeFrom,
										to: next,
									})
								}
							/>

							<div className="pt-1">
								<button
									type="button"
									onClick={onClearSelectedColumn}
									className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2 font-semibold text-[11px] text-slate-700 transition-colors hover:bg-slate-100"
								>
									Wyczyść zakres
								</button>
							</div>
						</div>
					) : (
						<>
							<div className="mb-2 flex flex-wrap items-center gap-2">
								<input
									type="text"
									value={searchValue}
									onChange={(event) => onSearchChange(event.target.value)}
									onKeyDown={(event) => {
										if (event.key !== "Enter" || !canApplySearchValue) {
											return;
										}

										event.preventDefault();
										onApplySearchValue(trimmedSearchValue);
									}}
									placeholder="Szukaj wartości..."
									className="h-8 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none transition-colors focus:border-blue-400"
								/>

								{canApplySearchValue ? (
									<button
										type="button"
										onClick={() => onApplySearchValue(trimmedSearchValue)}
										className="inline-flex h-8 items-center rounded-md border border-blue-300 bg-blue-50 px-2 font-semibold text-[11px] text-blue-700 transition-colors hover:bg-blue-100"
									>
										Dodaj
									</button>
								) : null}

								<button
									type="button"
									onClick={onSelectAllVisible}
									className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2 font-semibold text-[11px] text-slate-700 transition-colors hover:bg-slate-100"
								>
									Zaznacz
								</button>

								<button
									type="button"
									onClick={onClearSelectedColumn}
									className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2 font-semibold text-[11px] text-slate-700 transition-colors hover:bg-slate-100"
								>
									Wyczyść
								</button>
							</div>

							<div
								onScroll={onValuesScroll}
								className="subtle-vertical-scroll h-52 min-h-0 overflow-x-hidden overflow-y-auto rounded-md border border-slate-200 p-2"
							>
								{visibleValues.length === 0 ? (
									<p className="px-1 py-2 text-slate-500 text-sm">
										Brak wartości dla podanego wyszukiwania.
									</p>
								) : (
									<div className="space-y-1">
										{visibleValues.map((value) => {
											const isSelected = selectedValues.includes(value);
											const displayValue = isIsoDateValue(value)
												? formatIsoDateForDisplay(value) || value
												: value;

											return (
												<label
													key={`value-${columnLabel}-${value}`}
													className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-slate-800 text-sm hover:bg-slate-50"
												>
													<input
														type="checkbox"
														checked={isSelected}
														onChange={() => onToggleValue(value)}
														className="h-4 w-4 rounded border-slate-300 text-blue-600"
													/>
													<span className="min-w-0 break-words whitespace-normal">{displayValue}</span>
												</label>
											);
										})}
									</div>
								)}

								{isLoadingValues ? (
									<p className="px-1 py-2 text-slate-500 text-xs">Ładowanie kolejnych...</p>
								) : null}
							</div>
						</>
					)}
				</div>

				<div className="mt-3 flex justify-end gap-2 border-slate-200 border-t pt-2.5">
					<button
						type="button"
						onClick={onClearAllFilters}
						className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2.5 font-semibold text-slate-700 text-xs transition-colors hover:bg-slate-100"
					>
						Wyczyść wszystkie
					</button>

					<button
						type="button"
						onClick={onClose}
						className="inline-flex h-8 items-center rounded-md border border-[#6ea3f0] bg-[#2d4d7f] px-2.5 font-semibold text-slate-100 text-xs transition-colors hover:bg-[#375f99]"
					>
						OK
					</button>
				</div>
			</div>
		</div>
	);
}
