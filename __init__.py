import numpy as np
import pandas as pd


def tabela_estimated_params_sev_z_trendem(wynik_trendu, t_modelowy=19):
    y = np.asarray(wynik_trendu["srednie"], dtype=float)
    mu_t = np.asarray(wynik_trendu["trend"], dtype=float)
    n = len(y)

    a = wynik_trendu["a"]
    b = wynik_trendu["b"]

    mu_hat = {
        "linear": lambda: a + b * t_modelowy,
        "exponential": lambda: np.exp(a + b * t_modelowy),
    }[wynik_trendu["typ"]]()

    reszty = y - mu_t

    return pd.DataFrame({
        "mu_hat": [mu_hat],
        "sigma_sq_hat": [np.nan],
        "phi_hat_0": [np.sum(reszty ** 2) / (n - 2)],
        "phi_hat_2": [np.sum((reszty / mu_t) ** 2) / (n - 2)],
    })


estimated_params_sev_z_trendem = tabela_estimated_params_sev_z_trendem(
    wynik_trendu,
    t_modelowy=19,
)

display(
    estimated_params_sev_z_trendem.style.format(
        {
            "mu_hat": "{:.8f}",
            "sigma_sq_hat": "{:.8f}",
            "phi_hat_0": "{:.8f}",
            "phi_hat_2": "{:.12f}",
        },
        na_rep="",
    )
)
