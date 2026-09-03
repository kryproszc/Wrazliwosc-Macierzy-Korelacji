'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CustomAlertDialog } from '@/components/CustomAlertDialog';
import {
	useStochasticPaidSimulationStore,
	DEFAULT_STOCHASTIC_PAID_USER_STATE,
	type StochasticMethodType,
} from '@/stores/stochasticPaidSimulationStore';
import { useTrainDevideStoreDet } from '@/stores/trainDevideStoreDeterministyczny';
import { useExposureStore } from '@/stores/exposureStore';
import { useAddPaidStore } from '@/stores/addPaidStore';
import { useAddCoefficientsStore } from '@/stores/addCoefficientsStore';
import { useUserStore } from '@/app/_components/useUserStore';
import { useParamsymStore } from '@/stores/paramsymStore';
import { useDiscountRatesStore } from '@/stores/discountRatesStore';
import { useCombinedSDSummary } from '@/features/Parametryzacja/MultPaid/hooks/useCombinedSDSummary';
import { useSelectedValuesSD } from '@/features/Parametryzacja/MultPaid/hooks/useSelectedValuesSD';
import {
	SimulationLayout,
	SimulationControlPanel,
	type DataAvailabilityStatus,
} from '@/shared/components/Symulacje';
import { EmptyState } from '@/shared/components/calculation';
import { DataTableView } from '@/shared/ui/molecules/DataTableView';
import {
	validateVectorLengths,
	checkDataAvailability,
	getCalculationOptions,
	prepareSelectedValueCL,
	prepareSelectedValueSigma,
	prepareCombinedSDSummary,
	processNetBruttoParams,
	processDiscountRates,
	parseQuantiles,
} from '@/shared/utils';
import {
	useSimulationApi,
	type AlertState,
	type SimulationRequestData,
	type StatisticsRequestData,
} from '@/shared/hooks';
import { exportStatisticsToExcel } from '@/untils/exportToExcel';

export function StochasticPaidTab() {
	const hasPaidTriangleWatcherInitialized = useRef(false);
	const previousPaidTriangleRef = useRef<(number | null)[][] | undefined>(undefined);

	const [alertState, setAlertState] = useState<AlertState>({
		show: false,
		variant: 'info',
		title: '',
		message: '',
	});

	const { executeSimulation, executeStatistics, isCalculating, isCalculatingStatistics } = useSimulationApi();

	const {
		paidTriangle,
		selectedValuesCL,
		selectedValuesSigma,
		selectedDevJIndexes,
		selectedSigmaIndexes,
		leftCountCL,
		combinedDevJSummary,
		combinedSigmaSummary,
		devJ,
		selectedWeightsDet,
		safeWeights,
		setSafeWeights,
		tailCountCL,
		sd,
	} = useTrainDevideStoreDet();

	const { exposureTriangle, selectedExposureLine } = useExposureStore();
	const {
		selectedValuesAddLR,
		selectedValuesAddSigma,
		selectedValuesAddSD,
		combinedAddSDSummary,
		selectedAddJIndexes,
		leftCountAddLR,
		tailCountAddJ,
	} = useAddPaidStore();
	const { selectedWeightsAdd, trainDevideAdd } = useAddCoefficientsStore();

	const userId = useUserStore((s: any) => s.userId);
	const userKey = userId || '__anonymous__';

	const ensureUserState = useStochasticPaidSimulationStore((s) => s.ensureUserState);
	const setMethodTypeInStore = useStochasticPaidSimulationStore((s) => s.setMethodType);
	const setKChange = useStochasticPaidSimulationStore((s) => s.setKChange);
	const updateSimulationParamInStore = useStochasticPaidSimulationStore((s) => s.updateSimulationParam);
	const setKwantyleInStore = useStochasticPaidSimulationStore((s) => s.setKwantyle);
	const setStatisticsResultsInStore = useStochasticPaidSimulationStore((s) => s.setStatisticsResults);
	const setSimulationResultsInStore = useStochasticPaidSimulationStore((s) => s.setSimulationResults);
	const clearResultsInStore = useStochasticPaidSimulationStore((s) => s.clearResults);
	const resetUserStateInStore = useStochasticPaidSimulationStore((s) => s.resetUserState);
	const storedUserState = useStochasticPaidSimulationStore((s) => s.userStates[userKey]);

	const currentUserState = storedUserState ?? DEFAULT_STOCHASTIC_PAID_USER_STATE;
	const methodType = currentUserState.methodType;
	const kChageSimPaid = currentUserState.kChange;
	const simulationParams = currentUserState.simulationParams;
	const kwantyle = currentUserState.kwantyle;
	const statisticsResults = currentUserState.statisticsResults;
	const simulationResults = currentUserState.simulationResults;

	useEffect(() => {
		if (!storedUserState) {
			ensureUserState(userKey);
		}
	}, [storedUserState, ensureUserState, userKey]);

	const updateSimulationParam = (key: keyof typeof simulationParams, value: number) => {
		updateSimulationParamInStore(userKey, key, value);
	};

	const setKwantyle = (value: string) => {
		setKwantyleInStore(userKey, value);
	};

	const setStatisticsResults = (value: any[]) => {
		setStatisticsResultsInStore(userKey, value);
	};

	const setSimulationResults = (value: any) => {
		setSimulationResultsInStore(userKey, value);
	};

	const clearResults = () => {
		clearResultsInStore(userKey);
	};

	const setMethodType = (value: StochasticMethodType) => {
		setMethodTypeInStore(userKey, value);
	};

	const { getAsNumbers: getSelectedValuesSDAsNumbers, hasData: hasSelectedValuesSD } = useSelectedValuesSD();

	const getParamsymTriangle = useParamsymStore((s) => s.paramsymTriangle);
	const getSelectedParamsymLine = useParamsymStore((s) => s.selectedParamsymLine);
	const getDiscountRatesTriangle = useDiscountRatesStore((s) => s.discountRatesTriangle);
	const getSelectedDiscountRateLine = useDiscountRatesStore((s) => s.selectedDiscountRateLine);

	const dataAvailability = checkDataAvailability(
		paidTriangle || [],
		getDiscountRatesTriangle,
		getParamsymTriangle,
	);

	const calculationOptions = getCalculationOptions(dataAvailability);

	const hasResults = simulationResults !== null;
	const hasStatisticsResults = Array.isArray(statisticsResults) && statisticsResults.length > 0;
	const hasValidExplicitValues = (values: number[] | undefined) =>
		Array.isArray(values) && values.some((value) => Number.isFinite(value));
	const hasMultiplikatywnaCl = hasValidExplicitValues(selectedValuesCL);
	const hasMultiplikatywnaSigma = hasValidExplicitValues(selectedValuesSigma);
	const hasMultiplikatywnaSd = hasSelectedValuesSD;
	const hasAddytywnaLr = hasValidExplicitValues(selectedValuesAddLR);
	const hasAddytywnaSigma = hasValidExplicitValues(selectedValuesAddSigma);
	const hasAddytywnaSd = hasValidExplicitValues(selectedValuesAddSD);
	const hasBaseDataForSimulation = dataAvailability.paidTriangle;
	const showMultiplikatywna = hasBaseDataForSimulation && hasMultiplikatywnaCl && hasMultiplikatywnaSigma && hasMultiplikatywnaSd;
	const showAddytywna = hasBaseDataForSimulation && hasAddytywnaLr && hasAddytywnaSigma && hasAddytywnaSd;
	const showMix = showMultiplikatywna && showAddytywna;
	const isMultiplikatywnaDisabled = !showMultiplikatywna;
	const isAddytywnaDisabled = !showAddytywna;
	const isMixDisabled = !showMix;
	const isCurrentMethodUnavailable =
		(methodType === 'multiplikatywna' && isMultiplikatywnaDisabled)
		|| (methodType === 'addytywna' && isAddytywnaDisabled)
		|| (methodType === 'mix' && isMixDisabled);

	const showAlert = (alert: AlertState) => {
		if (
			alert.variant === 'success'
			&& (alert.title.includes('Statystyki') || alert.message.includes('Statystyki'))
		) {
			setAlertState({
				...alert,
				message: 'Statystki zotały obliczone',
			});
			return;
		}

		setAlertState(alert);
	};

	const hideAlert = () => {
		setAlertState((prev) => ({ ...prev, show: false }));
	};

	useEffect(() => {
		if (!hasPaidTriangleWatcherInitialized.current) {
			hasPaidTriangleWatcherInitialized.current = true;
			previousPaidTriangleRef.current = paidTriangle;
			return;
		}

		const hasPaidTriangleChanged = previousPaidTriangleRef.current !== paidTriangle;
		previousPaidTriangleRef.current = paidTriangle;

		if (!hasPaidTriangleChanged) {
			return;
		}

		// Resetujemy wyniki i wpisane wartości w boxach po ponownym załadowaniu paid
		resetUserStateInStore(userKey);
	}, [paidTriangle, resetUserStateInStore, userKey]);

	useEffect(() => {
		if (!isCurrentMethodUnavailable) {
			return;
		}

		if (showMultiplikatywna) {
			setMethodTypeInStore(userKey, 'multiplikatywna');
			return;
		}

		if (showAddytywna) {
			setMethodTypeInStore(userKey, 'addytywna');
			return;
		}

		if (showMix) {
			setMethodTypeInStore(userKey, 'mix');
		}
	}, [
		isCurrentMethodUnavailable,
		showMultiplikatywna,
		showAddytywna,
		showMix,
		setMethodTypeInStore,
		userKey,
	]);

	const dataAvailabilityStatus: DataAvailabilityStatus[] = [
		{
			label: 'Trójkąt Paid',
			isAvailable: dataAvailability.paidTriangle,
			status: dataAvailability.paidTriangle ? 'Wczytany' : 'Brak danych',
		},
	];

	const lightStatisticsTableData = useMemo(() => {
		if (!Array.isArray(statisticsResults) || statisticsResults.length === 0) {
			return null;
		}

		const formatValue = (value: unknown) => {
			if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
			return value.toLocaleString('pl-PL', {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).replace(/\u00A0/g, ' ');
		};

		const parsedQuantiles = parseQuantiles(kwantyle);
		const fixedColumnLabels = [
			'Brutto',
			'Brutto jednoroczne zdyskontowane',
			'Netto jednoroczne zdyskontowane',
		];
		const headers = ['METRYKA', ...statisticsResults.map((_: any, idx: number) => fixedColumnLabels[idx] ?? `Kolumna ${idx + 1}`)];
		const rows: string[][] = [headers];

		rows.push([
			'Średnia',
			...statisticsResults.map((stat: any) => formatValue(stat?.mean)),
		]);
		rows.push([
			'Odch. std.',
			...statisticsResults.map((stat: any) => formatValue(stat?.std)),
		]);

		parsedQuantiles.forEach((q, qIdx) => {
			rows.push([
				`Q${(q * 100).toFixed(1)}%`,
				...statisticsResults.map((stat: any) => formatValue(stat?.quantiles?.[qIdx])),
			]);
		});

		rows.push([
			'SCR',
			...statisticsResults.map((stat: any) => formatValue(stat?.SCR)),
		]);

		return rows;
	}, [statisticsResults, kwantyle]);

	const handleExecuteCalculations = async () => {
		clearResults();
		setStatisticsResults([]);

		if (isCurrentMethodUnavailable) {
			console.warn('[StochasticPaidTab] Brak selected values dla metody - kontynuuję na fallbackach.');
		}

		if (methodType === 'addytywna') {
			if (!userId) {
				showAlert({
					show: true,
					variant: 'error',
					title: 'Brak użytkownika',
					message: 'Brak user_id - nie można wykonać symulacji.',
				});
				return;
			}

			if (!dataAvailability.paidTriangle) {
				showAlert({
					show: true,
					variant: 'error',
					title: 'Błąd danych',
					message: 'Wymagany trójkąt paid do wykonania obliczeń Addytywnych.',
				});
				return;
			}

			if (!exposureTriangle || Object.keys(exposureTriangle).length === 0 || selectedExposureLine === null) {
				showAlert({
					show: true,
					variant: 'error',
					title: 'Błąd danych',
					message: 'Wymagane dane ekspozycji do wykonania obliczeń Addytywnych.',
				});
				return;
			}

			const selectedLine = exposureTriangle[selectedExposureLine];
			const exposureValues = selectedLine
				? Object.values(selectedLine).map((value) => (typeof value === 'number' ? value : 0))
				: [];

			const safeWeightsAdd = selectedWeightsAdd?.map((weightRow, rowIndex) =>
				weightRow.map((weight, colIndex) => {
					const trainValue = trainDevideAdd?.[rowIndex]?.[colIndex];
					if (trainValue === null || trainValue === undefined) return 0;
					return weight === 1 ? 1 : 0;
				}),
			) ?? [];

			const vectorSelectedValueSigmaAdd = prepareSelectedValueSigma(
				selectedValuesAddSigma,
				combinedAddSDSummary,
				selectedValuesAddSigma,
			);

			const vectorSelectedValueLRAdd = prepareSelectedValueCL(
				selectedValuesAddLR,
				[],
				[],
			);

			const vectorCombinedSDSummaryAdd = prepareCombinedSDSummary(
				selectedValuesAddSD,
				combinedAddSDSummary,
				selectedValuesAddSD,
			);

			const processedNetBrutto = processNetBruttoParams(
				getParamsymTriangle,
				getSelectedParamsymLine,
			);

			const processedDiscountRates = processDiscountRates(
				getDiscountRatesTriangle,
				getSelectedDiscountRateLine,
			);

			const requestDataAdd = {
				user_id: userId,
				paid_triangle: paidTriangle || [],
				weights: safeWeightsAdd,
				lr_indexes: selectedAddJIndexes || [],
				sigma_indexes: selectedAddJIndexes || [],
				left_count_lr: leftCountAddLR || 0,
				selected_value_lr: vectorSelectedValueLRAdd,
				selected_value_sigma: vectorSelectedValueSigmaAdd,
				combined_sd_summary: vectorCombinedSDSummaryAdd,
				tail_count_lr: tailCountAddJ || null,
				e_values: exposureValues,
				calculation_options: calculationOptions,
				discount_rates: processedDiscountRates,
				netto_brutto: processedNetBrutto,
				ilosc_symulacji: simulationParams.iloscSymulacji,
				ziarno: simulationParams.ziarno,
				podzial_ziarna: simulationParams.podzialZiarna,
				skalowanie: simulationParams.skalowanie,
				skalowanie2: simulationParams.skalowanie2,
				kwantyle: parseQuantiles(kwantyle),
			};

			console.log('🚀 [StochasticPaidTab] tryb Addytywna -> endpoint /calc/simulationHybAddpaid');
			console.log('📡 [Addytywna] URL:', '/calc/simulationHybAddpaid');
			console.log('📡 [Addytywna] Method:', 'POST');
			console.log('📡 [Addytywna] Headers:', {
				'Content-Type': 'application/json',
			});
			console.log('📦 [Addytywna] Payload (object):', requestDataAdd);
			console.log('📦 [Addytywna] Payload (pretty JSON):\n', JSON.stringify(requestDataAdd, null, 2));
			console.log('📦 [Addytywna] Payload (exact body):', JSON.stringify(requestDataAdd));
			const results = await executeSimulation(
				requestDataAdd as any,
				'/calc/simulationHybAddpaid',
				showAlert,
			);

			if (results) {
				setSimulationResults(results);
				setStatisticsResults([]);
			}
			return;
		}

		const parsedK = Number(kChageSimPaid);
		if (methodType === 'mix' && !Number.isFinite(parsedK)) {
			showAlert({
				show: true,
				variant: 'error',
				title: 'Błędny parametr k',
				message: 'Parametr k_chage_sim_paid musi być liczbą.',
			});
			return;
		}

		if (!userId) {
			showAlert({
				show: true,
				variant: 'error',
				title: 'Brak użytkownika',
				message: 'Brak user_id - nie można wykonać symulacji.',
			});
			return;
		}

		if (!dataAvailability.paidTriangle) {
			showAlert({
				show: true,
				variant: 'error',
				title: 'Błąd danych',
				message: 'Wymagany trójkąt paid do wykonania obliczeń.',
			});
			return;
		}

		const freshState = useTrainDevideStoreDet.getState();

		let calculatedSafeWeights: number[][];
		if (freshState.safeWeights && freshState.safeWeights.length > 0) {
			calculatedSafeWeights = freshState.safeWeights;
		} else {
			calculatedSafeWeights = freshState.selectedWeightsDet?.map((row) => row.map((cell) => (cell === 1 ? 1 : 0))) ?? [];
			setSafeWeights(calculatedSafeWeights);
		}

		const vectorSelectedValueCL = prepareSelectedValueCL(
			freshState.selectedValuesCL,
			combinedDevJSummary,
			devJ || [],
		);

		const vectorSelectedValueSigma = prepareSelectedValueSigma(
			freshState.selectedValuesSigma,
			combinedSigmaSummary,
			freshState.sigma || [],
		);

		const vectorCombinedSDSummary = prepareCombinedSDSummary(
			hasSelectedValuesSD ? getSelectedValuesSDAsNumbers() : [],
			freshState.combinedSDSummary || [],
			sd || [],
		);

		const validation = validateVectorLengths(
			vectorSelectedValueCL,
			vectorSelectedValueSigma,
			vectorCombinedSDSummary,
		);

		if (!validation.isValid) {
			showAlert({
				show: true,
				variant: 'error',
				title: 'Błąd długości wektorów',
				message: validation.errorMessage || 'Błąd walidacji wektorów',
			});
			return;
		}

		const processedNetBrutto = processNetBruttoParams(
			getParamsymTriangle,
			getSelectedParamsymLine,
		);

		const processedDiscountRates = processDiscountRates(
			getDiscountRatesTriangle,
			getSelectedDiscountRateLine,
		);

		const requestData: SimulationRequestData = {
			user_id: userId,
			paid_triangle: paidTriangle || [],
			weights: calculatedSafeWeights,
			cl_indexes: selectedDevJIndexes || [],
			sigma_indexes: selectedSigmaIndexes || [],
			left_count_cl: leftCountCL || 0,
			selected_value_cl: vectorSelectedValueCL,
			selected_value_sigma: vectorSelectedValueSigma,
			combined_sd_summary: vectorCombinedSDSummary,
			tail_count_cl: tailCountCL === '' || tailCountCL === null || tailCountCL === undefined
				? null
				: Number(tailCountCL),
			calculation_options: calculationOptions,
			discount_rates: processedDiscountRates,
			netto_brutto: processedNetBrutto,
			ilosc_symulacji: simulationParams.iloscSymulacji,
			ziarno: simulationParams.ziarno,
			podzial_ziarna: simulationParams.podzialZiarna,
			skalowanie: simulationParams.skalowanie,
			kwantyle: parseQuantiles(kwantyle),
		};

		if (methodType === 'mix') {
			if (!exposureTriangle || Object.keys(exposureTriangle).length === 0 || selectedExposureLine === null) {
				showAlert({
					show: true,
					variant: 'error',
					title: 'Błąd danych',
					message: 'W trybie Mix wymagane są dane ekspozycji (część Addytywna).',
				});
				return;
			}

			const selectedLine = exposureTriangle[selectedExposureLine];
			const exposureValues = selectedLine
				? Object.values(selectedLine).map((value) => (typeof value === 'number' ? value : 0))
				: [];

			const safeWeightsAdd = selectedWeightsAdd?.map((weightRow, rowIndex) =>
				weightRow.map((weight, colIndex) => {
					const trainValue = trainDevideAdd?.[rowIndex]?.[colIndex];
					if (trainValue === null || trainValue === undefined) return 0;
					return weight === 1 ? 1 : 0;
				}),
			) ?? [];

			const vectorSelectedValueSigmaAdd = prepareSelectedValueSigma(
				selectedValuesAddSigma,
				combinedAddSDSummary,
				selectedValuesAddSigma,
			);

			const vectorSelectedValueLRAdd = prepareSelectedValueCL(
				selectedValuesAddLR,
				[],
				[],
			);

			const vectorCombinedSDSummaryAdd = prepareCombinedSDSummary(
				selectedValuesAddSD,
				combinedAddSDSummary,
				selectedValuesAddSD,
			);

			const addytywnaPayload = {
				user_id: userId,
				paid_triangle: paidTriangle || [],
				weights: safeWeightsAdd,
				lr_indexes: selectedAddJIndexes || [],
				sigma_indexes: selectedAddJIndexes || [],
				left_count_lr: leftCountAddLR || 0,
				selected_value_lr: vectorSelectedValueLRAdd,
				selected_value_sigma: vectorSelectedValueSigmaAdd,
				combined_sd_summary: vectorCombinedSDSummaryAdd,
				tail_count_lr: tailCountAddJ || null,
				e_values: exposureValues,
				calculation_options: calculationOptions,
				discount_rates: processedDiscountRates,
				netto_brutto: processedNetBrutto,
				ilosc_symulacji: simulationParams.iloscSymulacji,
				ziarno: simulationParams.ziarno,
				podzial_ziarna: simulationParams.podzialZiarna,
				skalowanie: simulationParams.skalowanie,
				skalowanie2: simulationParams.skalowanie2,
				kwantyle: parseQuantiles(kwantyle),
			};

			const mixRequestData = {
				...requestData,
				k_chage_sim_paid: parsedK,
				lr_indexes: addytywnaPayload.lr_indexes,
				left_count_lr: addytywnaPayload.left_count_lr,
				selected_value_lr: addytywnaPayload.selected_value_lr,
				tail_count_lr: addytywnaPayload.tail_count_lr,
				e_values: addytywnaPayload.e_values,
				skalowanie2: addytywnaPayload.skalowanie2,
				weights_add: addytywnaPayload.weights,
				selected_value_sigma_add: addytywnaPayload.selected_value_sigma,
				combined_sd_summary_add: addytywnaPayload.combined_sd_summary,
				multiplikatywna_payload: requestData,
				addytywna_payload: addytywnaPayload,
			};

			console.log('🚀 [StochasticPaidTab] tryb Mix metod -> endpoint /calc/simulationHybAddClpaid');
			console.log('📡 [Mix] URL:', '/calc/simulationHybAddClpaid');
			console.log('📡 [Mix] Method:', 'POST');
			console.log('📡 [Mix] Headers:', {
				'Content-Type': 'application/json',
			});
			console.log('🧮 [Mix] Parametr zmiany k:', parsedK);
			console.log('📦 [Mix] Payload (object):', mixRequestData);
			console.log('📦 [Mix] Payload (pretty JSON):\n', JSON.stringify(mixRequestData, null, 2));
			console.log('📦 [Mix] Payload (exact body):', JSON.stringify(mixRequestData));

			const mixResults = await executeSimulation(
				mixRequestData as any,
				'/calc/simulationHybAddClpaid',
				showAlert,
			);

			if (mixResults) {
				setSimulationResults(mixResults);
				setStatisticsResults([]);
			}

			return;
		}

		if (methodType === 'multiplikatywna') {
			console.log('🚀 [StochasticPaidTab] tryb Multiplikatywna -> endpoint /calc/simulationHybClpaid');
		} else {
			console.log('🚀 [StochasticPaidTab] tryb Mix metod, k=0 -> endpoint /calc/simulationHybClpaid');
		}

		const results = await executeSimulation(
			requestData,
			'/calc/simulationHybClpaid',
			showAlert,
		);

		if (results) {
			setSimulationResults(results);
			setStatisticsResults([]);
		}
	};

	const handleExecuteStatistics = async () => {
		if (!userId) {
			showAlert({
				show: true,
				variant: 'error',
				title: 'Błąd użytkownika',
				message: 'Brak identyfikatora użytkownika.',
			});
			return;
		}

		let deterministicResultsFromPaid: StatisticsRequestData['deterministic_results'] = null;

		if (typeof window !== 'undefined') {
			try {
				const raw = window.sessionStorage.getItem('deterministic-paid-tab-state');
				if (raw) {
					const parsed = JSON.parse(raw) as {
						calculationResults?: {
							last_col?: number[];
							cum_trian?: number[];
							ult_net_disc?: number[];
							userId?: string;
						};
					};

					const calculationResults = parsed?.calculationResults;
					if (
						calculationResults &&
						calculationResults.userId === userId &&
						Array.isArray(calculationResults.last_col) && calculationResults.last_col.length > 0 &&
						Array.isArray(calculationResults.cum_trian) && calculationResults.cum_trian.length > 0 &&
						Array.isArray(calculationResults.ult_net_disc) && calculationResults.ult_net_disc.length > 0
					) {
						deterministicResultsFromPaid = {
							last_col: calculationResults.last_col,
							cum_trian: calculationResults.cum_trian,
							ult_net_disc: calculationResults.ult_net_disc,
							userId: calculationResults.userId || userId,
							calculatedAt: new Date().toISOString(),
						};
					}
				}
			} catch {
				deterministicResultsFromPaid = null;
			}
		}

		const hasDeterministicResults = Boolean(deterministicResultsFromPaid);

		if (!hasDeterministicResults) {
			showAlert({
				show: true,
				variant: 'warning',
				title: 'Brak danych deterministycznych',
				message: 'Aby policzyć statystyki hybrydowe, najpierw wykonaj obliczenia w zakładce Obliczenia deterministyczne -> Paid dla tego samego użytkownika.',
			});
			return;
		}

		const statisticsData: StatisticsRequestData = {
			user_id: userId,
			kwantyle: parseQuantiles(kwantyle),
			skalowanie: simulationParams.skalowanie,
			skalowanie2: simulationParams.skalowanie2,
			simulation_results: null,
			deterministic_results: deterministicResultsFromPaid,
		};

		console.log('🚀 [StochasticPaidTab] Endpoint statystyk: /calc/statisticHybClpaid');
		console.log('📤 [StochasticPaidTab] Wysyłane dane statystyk:', statisticsData);

		const results = await executeStatistics(
			statisticsData,
			'/calc/statisticHybClpaid',
			showAlert,
		);

		if (results) {
			setStatisticsResults(results);
		}
	};

	const handleExportStatistics = () => {
		exportStatisticsToExcel(
			statisticsResults as any,
			kwantyle,
			simulationParams.skalowanie,
			simulationParams,
		);
	};

	return (
		<>
			<SimulationLayout
				mainPadding="p-4 md:p-5"
				sidebar={
					<SimulationControlPanel
						sidebarWidth="w-48"
						sidebarPadding="p-3"
						compactActionButtons
						actionSectionTopSpacingClassName="pt-0"
						placeExecuteButtonAboveDivider
						sectionSpacingClassName="space-y-4"
						simulationParams={simulationParams}
						kwantyle={kwantyle}
						isCalculating={isCalculating}
						isCalculatingStatistics={isCalculatingStatistics}
						hasResults={hasResults}
						statisticsResultsCount={statisticsResults.length}
						dataAvailability={dataAvailabilityStatus}
						onUpdateSimulationParam={updateSimulationParam}
						onSetKwantyle={setKwantyle}
						onExecuteCalculations={handleExecuteCalculations}
						onExecuteStatistics={handleExecuteStatistics}
						onClearResults={clearResults}
						onClearStatistics={() => setStatisticsResults([])}
						onExportStatistics={handleExportStatistics}
						topContent={
							<div className="space-y-4">
								<div className="space-y-3 rounded-lg bg-gray-800 p-3">
									<label className="mb-1 block text-sm font-medium text-white">Wybór metody:</label>
									<div className="space-y-2">
										<label className={`flex items-center gap-2 text-sm font-medium ${isMultiplikatywnaDisabled ? 'cursor-not-allowed text-gray-500' : 'cursor-pointer text-gray-200'}`}>
											<input
												type="radio"
												name="stochastic_method_paid"
												checked={methodType === 'multiplikatywna'}
												onChange={() => setMethodType('multiplikatywna')}
												disabled={isMultiplikatywnaDisabled}
												className="accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
											/>
											<span>Multiplikatywna</span>
										</label>
										<label className={`flex items-center gap-2 text-sm font-medium ${isAddytywnaDisabled ? 'cursor-not-allowed text-gray-500' : 'cursor-pointer text-gray-200'}`}>
											<input
												type="radio"
												name="stochastic_method_paid"
												checked={methodType === 'addytywna'}
												onChange={() => setMethodType('addytywna')}
												disabled={isAddytywnaDisabled}
												className="accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
											/>
											<span>Addytywna</span>
										</label>
										<label className={`flex items-center gap-2 text-sm font-medium ${isMixDisabled ? 'cursor-not-allowed text-gray-500' : 'cursor-pointer text-gray-200'}`}>
											<input
												type="radio"
												name="stochastic_method_paid"
												checked={methodType === 'mix'}
												onChange={() => setMethodType('mix')}
												disabled={isMixDisabled}
												className="accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
											/>
											<span>Mix metod</span>
										</label>
									</div>
								</div>
								{methodType === 'mix' && (
									<div>
										<label htmlFor="k_chage_sim_paid" className="mb-2 block text-xs font-medium text-white">
											Parametr zmiany k:
										</label>
										<input
											id="k_chage_sim_paid"
											name="k_chage_sim_paid"
											type="number"
											step="0.01"
											value={kChageSimPaid}
											onChange={(event) => setKChange(userKey, event.target.value)}
											className="w-full rounded-md border border-gray-600 bg-white px-3 py-2 text-sm font-medium text-black focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
										/>
									</div>
								)}

								<hr className="border-gray-600" />
							</div>
						}
					/>
				}
			>
				<div className="space-y-6">
					{lightStatisticsTableData ? (
						<DataTableView
							title="Wyniki Statystyk"
							className="[&_*_table]:text-[11px]"
							lightHeaderClassName="bg-gradient-to-r from-gray-100 to-gray-50 px-3 py-1 border-b border-gray-300 rounded-t-2xl"
							lightTitleClassName="font-bold text-gray-800 text-sm tracking-tight"
							tableWrapperClassName="w-full overflow-auto max-h-[calc(100vh-8.5rem)]"
							data={lightStatisticsTableData}
							noDataMessage="Brak danych wynikowych do wyświetlenia"
							variant="light"
						/>
					) : (
						<EmptyState
							title=""
							description={'Dla wybranej metody kliknij "Wykonaj symulacje".'}
						/>
					)}
				</div>
			</SimulationLayout>

			<CustomAlertDialog
				open={alertState.show}
				onOpenChange={hideAlert}
				variant={alertState.variant}
				title={alertState.title}
				message={alertState.message}
				buttonText="OK"
			/>

			{isCalculating && (
				<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
					<div className="flex flex-col items-center gap-4 rounded-2xl bg-slate-900/95 px-10 py-8 shadow-2xl">
						<Loader2 className="h-16 w-16 animate-spin text-white" />
						<p className="text-lg font-semibold text-white">Trwają obliczenia symulacji...</p>
						<p className="text-sm text-slate-300">Poczekaj do zakończenia operacji.</p>
					</div>
				</div>
			)}
		</>
	);
}
