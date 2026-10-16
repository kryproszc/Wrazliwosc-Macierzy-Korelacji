
# ==========================================
# 1. OBLICZENIA — TRZY ROZKŁADY
# ==========================================

(
    tabela_ogolna,
    tabela_okresy,
    tabela_porownawcza,
    reszty_wszystkie,
    diagnostyka
) = porownaj_rozklady_paid_incurred(
    I=I,
    R=R,
    E_I=E_I,
    E_R=E_R,
    h=h,
    g=g,
    theta2_I=theta2_I,
    theta2_R=theta2_R,
    weights_inc=weights_inc,
    max_okres=5,
    n_resamples_ad=100000,
    seed=12345
)

# ==========================================
# 2. WYNIKI GLOBALNE
# ==========================================

print("PORÓWNANIE TRZECH ROZKŁADÓW — GLOBALNIE")
display(tabela_porownawcza)

# ==========================================
# 3. WYNIKI WEDŁUG OKRESÓW
# ==========================================

print("INCURRED — WYNIKI WEDŁUG OKRESÓW")
display(
    tabela_okresy[
        tabela_okresy["Model"] == "Incurred"
    ]
)

print("REZERWY — WYNIKI WEDŁUG OKRESÓW")
display(
    tabela_okresy[
        tabela_okresy["Model"] == "Rezerwy"
    ]
)

# ==========================================
# 4. DIAGNOSTYKA
# ==========================================

print("DIAGNOSTYKA OBSERWACJI")
display(diagnostyka)





########################





import numpy as np
import pandas as pd

wyniki_zakresy = []
diagnostyka_zakresy = []

for max_j in range(3, 22):

    (
        tabela_ogolna,
        tabela_okresy,
        tabela_porownawcza,
        reszty_wszystkie,
        diagnostyka
    ) = porownaj_rozklady_paid_incurred(
        I=I,
        R=R,
        E_I=E_I,
        E_R=E_R,
        h=h,
        g=g,
        theta2_I=theta2_I,
        theta2_R=theta2_R,
        weights_inc=weights_inc,
        max_okres=max_j,
        n_resamples_ad=None,
        seed=12345
    )

    # Wyniki globalne
    if not tabela_porownawcza.empty:
        temp = tabela_porownawcza.copy()
        temp.insert(0, "Max okres", max_j)
        wyniki_zakresy.append(temp)

    # Diagnostyka liczebności
    temp_diag = diagnostyka.copy()
    temp_diag.insert(0, "Max okres", max_j)
    diagnostyka_zakresy.append(temp_diag)


wyniki_zakresy = pd.concat(
    wyniki_zakresy, ignore_index=True
)

diagnostyka_zakresy = pd.concat(
    diagnostyka_zakresy, ignore_index=True
)

print("Analiza zakresów zakończona.")






ranking = wyniki_zakresy.copy()

# Ranking na podstawie statystyki KS
ranking["Ranking KS"] = (
    ranking.groupby(["Max okres", "Model"])[
        "Statystyka testowa KS"
    ].rank(method="min")
)

# Ranking na podstawie statystyki AD
ranking["Ranking AD"] = (
    ranking.groupby(["Max okres", "Model"])[
        "Statystyka testowa AD"
    ].rank(method="min")
)

ranking["Suma rang"] = (
    ranking["Ranking KS"] + ranking["Ranking AD"]
)

najlepsze = (
    ranking.sort_values(
        ["Max okres", "Model", "Suma rang"]
    )
    .groupby(["Max okres", "Model"])
    .first()
    .reset_index()
)

display(
    najlepsze[
        [
            "Max okres",
            "Model",
            "Rozkład",
            "Liczebność próby",
            "Statystyka testowa KS",
            "Statystyka testowa AD",
            "Suma rang"
        ]
    ].round(6)
)




import matplotlib.pyplot as plt

for model in ["Incurred", "Rezerwy"]:

    dane = wyniki_zakresy[
        wyniki_zakresy["Model"] == model
    ]

    fig, ax = plt.subplots(figsize=(10, 5))

    for rozklad in ["normal", "gamma", "lognormal"]:

        d = dane[dane["Rozkład"] == rozklad]

        ax.plot(
            d["Max okres"],
            d["Statystyka testowa AD"],
            marker="o",
            label=rozklad
        )

    ax.set_title(
        f"{model} — statystyka AD według zakresu rozwoju"
    )
    ax.set_xlabel("Maksymalny okres rozwoju")
    ax.set_ylabel("Statystyka AD")
    ax.set_xticks(range(3, 22))
    ax.grid(alpha=0.3)
    ax.legend()

    plt.show()


