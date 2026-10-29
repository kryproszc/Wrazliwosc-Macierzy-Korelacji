import numpy as np


def latest(nb_triangle):
    t = np.asarray(nb_triangle, dtype=float)
    n, m = t.shape

    if n != m:
        raise ValueError("Trójkąt musi być kwadratowy.")

    return t[np.arange(n), n - 1 - np.arange(n)].copy()


def ultimate(nb_triangle, ldf):
    t = np.array(nb_triangle, dtype=float, copy=True)
    ldf = np.asarray(ldf, dtype=float)

    n, m = t.shape

    if n != m:
        raise ValueError("Trójkąt musi być kwadratowy.")

    if ldf.shape != (n - 1,):
        raise ValueError(f"Potrzeba {n - 1} współczynników LDF.")

    if not np.all(np.isfinite(ldf)):
        raise ValueError("W LDF są brakujące lub nieskończone wartości.")

    for i in range(n):
        ostatnia_obserwowana = n - 1 - i

        for j in range(ostatnia_obserwowana + 1, n):
            t[i, j] = t[i, j - 1] * ldf[j - 1]

    return t

def frequency(nb_ult, expo):
    nb_ult = np.asarray(nb_ult, dtype=float)
    expo = np.asarray(expo, dtype=float)

    if nb_ult.shape != expo.shape:
        raise ValueError("Nb_Ult i expo muszą mieć ten sam wymiar.")

    if np.any(~np.isfinite(expo)) or np.any(expo <= 0):
        raise ValueError("Ekspozycja musi być dodatnia i bez braków.")

    return nb_ult / expo


# 1. Liczba szkód zgłoszonych — przekątna.
Nb_Rep = latest(nb_triangle)

# 2. Rozwinięcie całego trójkąta.
nb_triangle_full = ultimate(nb_triangle, ldf)

# Ostatnia kolumna rozwiniętego trójkąta.
Nb_Ult = nb_triangle_full[:, -1].copy()

# Muszą odpowiadać kolejności wierszy nb_triangle.
lata = np.arange(2007, 2025)

lata_expo = dane["ekspozycja"]["rok"]
wartosci_expo = dane["ekspozycja"]["wartosc"]

# Pobieramy dokładnie jeden rekord dla każdego roku.
expo = np.empty(len(lata))

for i, rok in enumerate(lata):
    pozycje = np.flatnonzero(lata_expo == rok)

    if len(pozycje) != 1:
        raise ValueError(f"Brak lub powtórzona ekspozycja dla roku {rok}.")

    expo[i] = wartosci_expo[pozycje[0]]

# 3. Częstość.
FREQ = frequency(Nb_Ult, expo)

import pandas as pd

tabela = pd.DataFrame({
    "YEAR": lata,
    "expo": expo,
    "Nb_Rep": Nb_Rep,
    "Nb_Ult": Nb_Ult,
    "FREQ": FREQ,
})

display(tabela)
