import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.stats import linregress


# 1. FUNKCJA LICZĄCA TREND LINIOWY OLS
def licz_trend(srednie):
    y = np.asarray(srednie, dtype=float).reshape(-1)
    t = np.arange(1, len(y) + 1, dtype=float)

    if len(y) < 3:
        raise ValueError("Potrzebne są co najmniej 3 obserwacje.")

    if not np.all(np.isfinite(y)):
        raise ValueError("Średnie zawierają NaN lub wartości nieskończone.")

    if np.all(y == y[0]):
        raise ValueError("Szereg jest stały — diagnostyka trendu jest zdegenerowana.")

    # OLS z wyrazem wolnym; każdy rok ma wagę 1.
    model = linregress(t, y)

    return {
        "t": t,
        "srednie": y,
        "trend": model.intercept + model.slope * t,
        "a": model.intercept,
        "b": model.slope,
        "p_value": model.pvalue,     # test dwustronny H0: b = 0
        "R2": model.rvalue ** 2,
    }


# 2. FUNKCJA RYSUJĄCA WYKRES
def rysuj_trend(wynik, lata):
    lata = np.asarray(lata).reshape(-1)

    if len(lata) != len(wynik["srednie"]):
        raise ValueError("Liczba lat musi odpowiadać liczbie średnich.")

    fig, ax = plt.subplots(figsize=(10, 5))

    ax.plot(
        lata, wynik["srednie"],
        marker="o", color="steelblue",
        label="Średnia szkoda typowa",
    )

    ax.plot(
        lata, wynik["trend"],
        color="darkorange",
        label="Trend liniowy OLS",
    )

    ax.set_xlabel("Rok szkodowy")
    ax.set_ylabel("Średnia wartość szkody")
    ax.set_title("Średnia szkoda typowa i trend")
    ax.ticklabel_format(axis="y", style="plain")
    ax.grid(alpha=0.25)
    ax.legend()

    fig.tight_layout()
    plt.show()

    return fig, ax


# 3. FUNKCJA ZWRACAJĄCA TABELĘ DIAGNOSTYCZNĄ
def tabela_trendu(wynik):
    return pd.DataFrame({
        "a": [wynik["a"]],
        "b": [wynik["b"]],
        "p-value (H0: b = 0)": [wynik["p_value"]],
        "R2": [wynik["R2"]],
    })


# ============================================================
# WYWOŁANIE — podstaw swoje średnie i lata
# ============================================================

# ac_mean: tablica średnich AC_Am_Ult / AC_Nb_Ult
# lata: tablica odpowiadających im lat szkodowych

wynik_trendu = licz_trend(ac_mean)

rysuj_trend(wynik_trendu, lata)

diagnostic = tabela_trendu(wynik_trendu)
display(diagnostic)
