import numpy as np
import pandas as pd
from scipy import stats


def parametry_FREQ_AC(estimated_params, ekspozycja_modelowa):
    mu_hat = float(estimated_params.iloc[0]["mu_hat"])
    phi_hat = float(estimated_params.iloc[0]["phi_hat"])

    m = mu_hat * ekspozycja_modelowa
    v = phi_hat * m

    return pd.DataFrame({
        "Rozklad": ["Poisson", "NBinom"],
        "Srednia": [m, m],
        "Wariancja": [m, v],
        "Odchylenie": [np.sqrt(m), np.sqrt(v)],
        "Parametry": [
            {"lam": m},
            {"n": m ** 2 / (v - m), "p": m / v},
        ],
    })


FREQ_AC = parametry_FREQ_AC(
    estimated_params=estimated_params_AC,
    ekspozycja_modelowa=expo_modelowa,
)

display(FREQ_AC)
