import numpy as np
import pandas as pd


def estymuj_momenty_ave(wynik_trendu, t_modelowy=None):
   
    y = np.asarray(wynik_trendu["srednie"], dtype=float)
    mu_t = np.asarray(wynik_trendu["trend"], dtype=float)

    if t_modelowy is None:
        t_modelowy = n + 1

    a = float(wynik_trendu["a"])
    b = float(wynik_trendu["b"])
    typ = wynik_trendu["typ"]

    # Wartość trendu w roku modelowym
    if typ == "linear":
        mu_model = a + b * t_modelowy
    elif typ == "exponential":
        mu_model = np.exp(a + b * t_modelowy)
    else:
        raise ValueError("Obsługiwane typy: 'linear', 'exponential'.")

    if (
        not np.isfinite(mu_model)
        or mu_model <= 0
        or np.any(mu_t <= 0)
    ):
        raise ValueError(
            "Do porównania normalnego, gamma i lognormalnego "
            "wartości oczekiwane muszą być dodatnie."
        )

    # 1. Bez trendu: wzory z mianownikiem N - 1
    mu_bez = np.mean(y)
    sigma_sq_bez = np.sum((y - mu_bez) ** 2) / (n - 1)

    # 2. Z trendem: odchylenia od dopasowanego trendu
    reszty = y - mu_t

    # p = 0: rozkład normalny
    phi_0 = np.sum(reszty ** 2) / (n - 2)
    sigma_sq_0 = phi_0

    # p = 2: rozkłady gamma i lognormalny
    phi_2 = np.sum(reszty ** 2 / mu_t ** 2) / (n - 2)
    sigma_sq_2 = phi_2 * mu_model ** 2

    tabela = pd.DataFrame([
        {
            "wariant": "bez trendu",
            "rozkład": "normalny / gamma / lognormalny",
            "p": np.nan,
            "mu_hat": mu_bez,
            "sigma_sq_hat": sigma_sq_bez,
            "phi_hat": np.nan,
        },
        {
            "wariant": f"z trendem: {typ}",
            "rozkład": "normalny",
            "p": 0,
            "mu_hat": mu_model,
            "sigma_sq_hat": sigma_sq_0,
            "phi_hat": phi_0,
        },
        {
            "wariant": f"z trendem: {typ}",
            "rozkład": "gamma / lognormalny",
            "p": 2,
            "mu_hat": mu_model,
            "sigma_sq_hat": sigma_sq_2,
            "phi_hat": phi_2,
        },
    ])

    tabela["sigma_hat"] = np.sqrt(tabela["sigma_sq_hat"])

    return tabela


estimated_params_ave = estymuj_momenty_ave(
    wynik_trendu,
    t_modelowy=19,
)

display(estimated_params_ave)
