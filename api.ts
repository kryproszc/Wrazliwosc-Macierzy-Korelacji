from fastapi import APIRouter
import numpy as np
from .models import ExecuteChangeMethodRequest
from cl_simulator import YearHorizont2

router = APIRouter()
yh2 = YearHorizont2()

@router.post("/calc_change_method/execute_calculations")
async def execute_change_method(request: ExecuteChangeMethodRequest):
	# Dane z frontu bez walidacji (waliduje Pydantic)
	data = np.array(request.paid_triangle, dtype=float)
	f = np.array(request.selected_value_cl, dtype=float)
	lr = np.array(request.selected_value_lr, dtype=float)
	exposure = np.array(request.ekspozycja, dtype=float)
	k_change = int(request.k_change)
	# discount_rates i netto_dysk mogą być puste
	if not request.discount_rates or not any(request.discount_rates.values()):
		discount_factors = np.ones(len(f), dtype=float)
	else:
		discount_values = [
			v for k, v in request.discount_rates[next(iter(request.discount_rates))].items()
			if k != "0" and v is not None
		]
		if not discount_values:
			discount_factors = np.ones(len(f), dtype=float)
		else:
			discount_factors = np.array(discount_values, dtype=float)

	if not request.netto_dysk or not any(request.netto_dysk.values()):
		net_to_gross = np.ones(data.shape[0], dtype=float)
	else:
		netto_dysk_values = [
			v for k, v in request.netto_dysk[next(iter(request.netto_dysk))].items()
			if k != "0" and v is not None
		]
		if not netto_dysk_values:
			net_to_gross = np.ones(data.shape[0], dtype=float)
		else:
			net_to_gross = np.array(netto_dysk_values, dtype=float)
	# Wywołanie funkcji obliczeń
	ult_det = yh2.triangle_forward_change(
		data,
		f,
		lr,
		exposure,
		k_change,
		discount_factors,
		net_to_gross
	)
    
	return {
		"status": "ok",
		"vectors": {
			"last_col": np.array(ult_det["last_col"]).tolist(),
			"latest": np.array(ult_det["latest"]).tolist(),
			"cum_trian": np.array(ult_det["cum_trian"]).tolist(),
			"ult_net_disc": np.array(ult_det["ult_net_disc"]).tolist(),
			"last_col_minus_latest": np.array(ult_det["last_col_minus_latest"]).tolist(),
			"cum_trian_minus_latest": np.array(ult_det["cum_trian_minus_latest"]).tolist(),
			"ult_net_disc_minus_latest": np.array(ult_det["ult_net_disc_minus_latest"]).tolist(),
		},
	}
