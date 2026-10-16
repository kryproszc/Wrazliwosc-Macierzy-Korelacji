import numpy as np

# 1. Trójkąty skumulowane
C = paid_df.to_numpy(dtype=np.float64)
I = incurred_df.to_numpy(dtype=np.float64)

# 2. Wspólne obserwacje
mask = np.isfinite(C) & np.isfinite(I)

C = np.where(mask, C, np.nan)
I = np.where(mask, I, np.nan)

# 3. Macierz rezerw
R = I - C

# 4. Przyrosty Incurred
X_I = np.full_like(I, np.nan)
X_I[:, 0] = I[:, 0]
X_I[:, 1:] = I[:, 1:] - I[:, :-1]

# 5. Pozostałe macierze
X_R = R.copy()
E_I = I.copy()
E_R = R.copy()

# 6. Indywidualne współczynniki Incurred
X_next = X_I[:, 1:]
E_current = E_I[:, :-1]

L_I = np.full_like(X_next, np.nan)

valid = np.isfinite(X_next) & np.isfinite(E_current)

positive = valid & (E_current > 0)
zero = valid & (E_current == 0)

L_I[positive] = X_next[positive] / E_current[positive]
L_I[zero] = 0.0

import numpy as np

# Konwersja do NumPy
X_R_np = np.asarray(X_R, dtype=np.float64)
E_R_np = np.asarray(E_R, dtype=np.float64)

# Licznik: X^R_(i,j+1)
X_next_R = X_R_np[:, 1:]

# Mianownik: E^R_(i,j)
E_current_R = E_R_np[:, :-1]

# Macierz współczynników rozwoju rezerw
L_R = np.full_like(X_next_R, np.nan)

# Dostępne obserwacje
valid = np.isfinite(X_next_R) & np.isfinite(E_current_R)

# Dodatni nośnik ryzyka
positive = valid & (E_current_R > 0)

L_R[positive] = X_next_R[positive] / E_current_R[positive]

# Zerowy nośnik ryzyka
zero = valid & (E_current_R == 0)

L_R[zero] = 0.0



# 1. Rezerwy
R = np.round(I - C, 2)

# 2. Ekspozycje
E_R = R.copy()
X_R = R.copy()

# 3. Indywidualne współczynniki
L_R = np.full((R.shape[0], R.shape[1] - 1), np.nan)

E_current_R = E_R[:, :-1]
X_next_R = X_R[:, 1:]

valid = np.isfinite(E_current_R) & np.isfinite(X_next_R)

positive = valid & (E_current_R > 0)
zero = valid & (E_current_R == 0)

L_R[positive] = X_next_R[positive] / E_current_R[positive]
L_R[zero] = 0.0




import numpy as np


def calculate_parameters_inc(
    L_I,
    E_I,
    weights_inc,
    weights_var_inc=None
):
    """
    Estymacja parametrów średniej i wariancji
    modelu Paid-Incurred dla szkód zgłoszonych.

    Zwraca
    -------
    h : ndarray (a-1,)
        Współczynniki rozwoju Incurred.

    theta2_I : ndarray (a-1,)
        Parametry wariancji Incurred.
    """

    L_I = np.asarray(L_I, dtype=np.float64)
    E_I = np.asarray(E_I, dtype=np.float64)
    weights_inc = np.asarray(weights_inc, dtype=np.float64)

    if weights_var_inc is None:
        weights_var_inc = weights_inc.copy()
    else:
        weights_var_inc = np.asarray(
            weights_var_inc, dtype=np.float64
        )

    a = E_I.shape[0]

    # Kontrola wymiarów
    if E_I.shape != (a, a):
        raise ValueError("E_I musi mieć wymiar (a, a).")

    if L_I.shape != (a, a - 1):
        raise ValueError("L_I musi mieć wymiar (a, a-1).")

    for name, w in [
        ("weights_inc", weights_inc),
        ("weights_var_inc", weights_var_inc)
    ]:
        if w.shape != (a - 1, a - 1):
            raise ValueError(f"Nieprawidłowy wymiar {name}.")

        if not np.all(np.isin(w, [0, 1])):
            raise ValueError(f"{name} musi zawierać 0 lub 1.")

    h = np.full(a - 1, np.nan)
    theta2_I = np.full(a - 1, np.nan)

    # =========================================
    # 1. ESTYMACJA ŚREDNIEJ h_j
    # =========================================

    for j in range(a - 1):

        n = a - j - 1

        E_j = E_I[:n, j]
        L_j = L_I[:n, j]
        w_j = weights_inc[:n, j]

        selected = w_j == 1

        E_sel = E_j[selected]
        L_sel = L_j[selected]

        if not (
            np.all(np.isfinite(E_sel))
            and np.all(np.isfinite(L_sel))
        ):
            raise ValueError(
                f"Okres j={j+1}: niepoprawne dane."
            )

        denominator = np.sum(E_sel)
        numerator = np.sum(E_sel * L_sel)

        if denominator <= 0:
            raise ValueError(
                f"Okres j={j+1}: mianownik <= 0. "
                "Wymagana ekstrapolacja."
            )

        h[j] = numerator / denominator

    # =========================================
    # 2. ESTYMACJA WARIANCJI
    # =========================================

    for j in range(a - 2):

        n = a - j - 1

        E_j = E_I[:n, j]
        L_j = L_I[:n, j]
        w_j = weights_var_inc[:n, j]

        selected = w_j == 1
        N = np.sum(selected)

        if N <= 1:
            raise ValueError(
                f"Okres j={j+1}: liczba obserwacji <= 1. "
                "Wymagana ekstrapolacja."
            )

        E_sel = E_j[selected]
        L_sel = L_j[selected]

        if not (
            np.all(np.isfinite(E_sel))
            and np.all(np.isfinite(L_sel))
        ):
            raise ValueError(
                f"Okres j={j+1}: niepoprawne dane."
            )

        if np.any(E_sel < 0):
            raise ValueError(
                f"Okres j={j+1}: ujemny nośnik ryzyka."
            )

        denominator = np.sum(E_sel)

        if denominator <= 0:
            raise ValueError(
                f"Okres j={j+1}: niedodatni mianownik."
            )

        # Średnia wyznaczona z wag wariancyjnych
        h_r = np.sum(E_sel * L_sel) / denominator

        theta2_I[j] = (
            np.sum(E_sel * (L_sel - h_r)**2)
            / (N - 1)
        )

    # =========================================
    # 3. EKSTRAPOLACJA OSTATNIEJ WARIANCJI
    # =========================================

    if not np.all(np.isfinite(theta2_I[-3:-1])):
        raise ValueError(
            "Brak dwóch poprzednich parametrów wariancji."
        )

    if theta2_I[-3] <= 0:
        raise ValueError(
            "Nie można zastosować ekstrapolacji: "
            "theta2_I[-3] <= 0."
        )

    theta2_I[-1] = min(
        theta2_I[-2]**2 / theta2_I[-3],
        theta2_I[-3],
        theta2_I[-2]
    )

    return h, theta2_I



import numpy as np


def calculate_parameters_R(
    L_R,
    E_R,
    weights_R,
    j_star=15,
    weights_var_R=None
):
    """
    Estymacja parametrów średniej i wariancji
    modelu Paid-Incurred dla rezerw.

    Zwraca
    -------
    g : ndarray (a-1,)
        Współczynniki rozwoju rezerw.

    theta2_R : ndarray (a-1,)
        Parametry wariancji rezerw.
    """

    L_R = np.asarray(L_R, dtype=np.float64)
    E_R = np.asarray(E_R, dtype=np.float64)
    weights_R = np.asarray(weights_R, dtype=np.float64)

    if weights_var_R is None:
        weights_var_R = weights_R.copy()
    else:
        weights_var_R = np.asarray(
            weights_var_R, dtype=np.float64
        )

    a = E_R.shape[0]

    # Kontrola wymiarów
    if E_R.shape != (a, a):
        raise ValueError("E_R musi mieć wymiar (a, a).")

    if L_R.shape != (a, a - 1):
        raise ValueError("L_R musi mieć wymiar (a, a-1).")

    for name, w in [
        ("weights_R", weights_R),
        ("weights_var_R", weights_var_R)
    ]:
        if w.shape != (a - 1, a - 1):
            raise ValueError(f"Nieprawidłowy wymiar {name}.")

        if not np.all(np.isin(w, [0, 1])):
            raise ValueError(f"{name} musi zawierać 0 lub 1.")

    if not isinstance(j_star, (int, np.integer)):
        raise ValueError("j_star musi być liczbą całkowitą.")

    if not 1 <= j_star <= a - 1:
        raise ValueError("Nieprawidłowe j_star.")

    g = np.zeros(a - 1, dtype=np.float64)
    theta2_R = np.zeros(a - 1, dtype=np.float64)

    # =========================================
    # 1. ESTYMACJA ŚREDNIEJ g_j
    # =========================================

    for j in range(j_star - 1):

        n = a - j - 1

        E_j = E_R[:n, j]
        L_j = L_R[:n, j]
        w_j = weights_R[:n, j]

        selected = w_j == 1

        E_sel = E_j[selected]
        L_sel = L_j[selected]

        if not (
            np.all(np.isfinite(E_sel))
            and np.all(np.isfinite(L_sel))
        ):
            raise ValueError(
                f"Okres j={j+1}: niepoprawne dane."
            )

        denominator = np.sum(E_sel)
        numerator = np.sum(E_sel * L_sel)

        if denominator <= 0:
            raise ValueError(
                f"Okres j={j+1}: niedodatni mianownik."
            )

        g[j] = numerator / denominator

        if g[j] <= 0:
            raise ValueError(
                f"Okres j={j+1}: g_j={g[j]}. "
                "Wymagane g_j > 0."
            )

    # =========================================
    # 2. ESTYMACJA WARIANCJI
    # =========================================

    for j in range(min(j_star - 1, a - 2)):

        n = a - j - 1

        E_j = E_R[:n, j]
        L_j = L_R[:n, j]
        w_j = weights_var_R[:n, j]

        selected = w_j == 1
        N = np.sum(selected)

        if N <= 1:
            raise ValueError(
                f"Okres j={j+1}: liczba obserwacji <= 1. "
                "Wymagana ekstrapolacja."
            )

        E_sel = E_j[selected]
        L_sel = L_j[selected]

        if not (
            np.all(np.isfinite(E_sel))
            and np.all(np.isfinite(L_sel))
        ):
            raise ValueError(
                f"Okres j={j+1}: niepoprawne dane."
            )

        denominator = np.sum(E_sel)

        if denominator <= 0:
            raise ValueError(
                f"Okres j={j+1}: niedodatni mianownik."
            )

        # Średnia wyznaczona z wag wariancyjnych
        g_r = np.sum(E_sel * L_sel) / denominator

        theta2_R[j] = (
            np.sum(E_sel * (L_sel - g_r)**2)
            / (N - 1)
        )

    # =========================================
    # 3. ZEROWANIE OD j_star
    # =========================================

    g[j_star - 1:] = 0.0
    theta2_R[j_star - 1:] = 0.0

    return g, theta2_R



import numpy as np
from scipy.stats import spearmanr, rankdata


def calculate_lambda(
    X_I, X_R, E_I, E_R,
    h, g, theta2_I, theta2_R,
    weights_lambda,
    j_star
):
    """
    Estymacja korelacji Spearmana w modelu Paid-Incurred.

    Dla E_R = 0 przyjmujemy r_R = 0.
    Rangi wiązane uwzględniamy metodą średnich rang.

    Zwraca
    -------
    lambda_S : ndarray (a-1,)
        Korelacje Spearmana.

    r_I : ndarray (a, a-1)
        Standaryzowane reszty Incurred.

    r_R : ndarray (a, a-1)
        Standaryzowane reszty rezerw.

    diagnostics : list
        (okres, liczba_obserwacji, status)
    """

    X_I = np.asarray(X_I, dtype=np.float64)
    X_R = np.asarray(X_R, dtype=np.float64)
    E_I = np.asarray(E_I, dtype=np.float64)
    E_R = np.asarray(E_R, dtype=np.float64)

    h = np.asarray(h, dtype=np.float64)
    g = np.asarray(g, dtype=np.float64)

    theta2_I = np.asarray(theta2_I, dtype=np.float64)
    theta2_R = np.asarray(theta2_R, dtype=np.float64)

    W = np.asarray(weights_lambda, dtype=np.float64)

    a = E_I.shape[0]

    # =========================================
    # 1. KONTROLA WYMIARÓW
    # =========================================

    if E_I.shape != (a, a) or E_R.shape != (a, a):
        raise ValueError("Nieprawidłowe wymiary E_I lub E_R.")

    if X_I.shape != (a, a) or X_R.shape != (a, a):
        raise ValueError("Nieprawidłowe wymiary X_I lub X_R.")

    if W.shape != (a - 1, a - 1):
        raise ValueError("Nieprawidłowy wymiar wag.")

    for name, x in [
        ("h", h),
        ("g", g),
        ("theta2_I", theta2_I),
        ("theta2_R", theta2_R)
    ]:
        if x.shape != (a - 1,):
            raise ValueError(f"Nieprawidłowy wymiar {name}.")

    if not np.all(np.isin(W, [0, 1])):
        raise ValueError("Wagi muszą zawierać tylko 0 i 1.")

    if not isinstance(j_star, (int, np.integer)):
        raise ValueError("j_star musi być liczbą całkowitą.")

    if not 1 <= j_star <= a - 1:
        raise ValueError("Nieprawidłowe j_star.")

    # =========================================
    # 2. MACIERZE WYNIKOWE
    # =========================================

    lambda_S = np.full(a - 1, np.nan)

    r_I = np.full((a, a - 1), np.nan)
    r_R = np.full((a, a - 1), np.nan)

    diagnostics = []

    # =========================================
    # 3. ESTYMACJA KORELACJI
    # =========================================

    for j in range(j_star - 1):

        n_rows = a - j - 1

        selected = np.flatnonzero(
            W[:n_rows, j] == 1
        )

        n = len(selected)

        if n <= 5:
            diagnostics.append(
                (j + 1, n, "Wymagana agregacja")
            )
            continue

        EI = E_I[selected, j]
        ER = E_R[selected, j]

        XI = X_I[selected, j + 1]
        XR = X_R[selected, j + 1]

        # =====================================
        # 4. KONTROLA DANYCH
        # =====================================

        if (
            np.any(~np.isfinite(EI))
            or np.any(~np.isfinite(ER))
            or np.any(~np.isfinite(XI))
            or np.any(~np.isfinite(XR))
            or np.any(EI <= 0)
            or np.any(ER < 0)
            or not np.isfinite(theta2_I[j])
            or not np.isfinite(theta2_R[j])
            or theta2_I[j] <= 0
            or theta2_R[j] <= 0
        ):
            diagnostics.append(
                (j + 1, n, "Standaryzacja niemożliwa")
            )
            continue

        # =====================================
        # 5. RESZTY INCURRED
        # =====================================

        ri = (
            (XI / EI - h[j])
            * np.sqrt(EI)
            / np.sqrt(theta2_I[j])
        )

        # =====================================
        # 6. RESZTY REZERW
        # =====================================

        rr = np.zeros(n, dtype=np.float64)

        positive_R = ER > 0

        rr[positive_R] = (
            (XR[positive_R] / ER[positive_R] - g[j])
            * np.sqrt(ER[positive_R])
            / np.sqrt(theta2_R[j])
        )

        # Dla E_R = 0 pozostaje r_R = 0

        r_I[selected, j] = ri
        r_R[selected, j] = rr

        # =====================================
        # 7. KORELACJA SPEARMANA
        # =====================================

        if (
            np.unique(ri).size < 2
            or np.unique(rr).size < 2
        ):
            diagnostics.append(
                (j + 1, n, "Stałe reszty")
            )
            continue

        lambda_S[j] = spearmanr(ri, rr).statistic

        # =====================================
        # 8. DIAGNOSTYKA RANG
        # =====================================

        ties = (
            len(np.unique(ri)) < n
            or len(np.unique(rr)) < n
        )

        if ties:
            status = "Rangi wiązane"
        else:
            status = "OK"

        diagnostics.append((j + 1, n, status))

    # =========================================
    # 9. ZEROWANIE OD j_star
    # =========================================

    lambda_S[j_star - 1:] = 0.0

    return lambda_S, r_I, r_R, diagnostics



import numpy as np

def calculate_inflation_paid_incurred(
    X_paid_hat,
    inflacja,
    valuation_year=2024
):
    """
    Punkt 9 dokumentacji Paid-Incurred.

    Indeksacja przyszłych oczekiwanych płatności inflacją.

    Zwraca
    -------
    X_indexed : ndarray (a, a)
        Przyszłe płatności indeksowane inflacją.
        Część historyczna = NaN.

    inflation_factors : ndarray (a, a)
        Współczynniki inflacyjne dla przyszłych komórek.
    """

    X = np.asarray(X_paid_hat, dtype=np.float64)
    inflacja = np.asarray(inflacja, dtype=np.float64)

    a = X.shape[0]

    if X.shape != (a, a):
        raise ValueError("Trójkąt musi mieć wymiar (a, a).")

    if inflacja.ndim != 2 or inflacja.shape[1] != 2:
        raise ValueError("Inflacja musi mieć dwie kolumny: rok i stopa.")

    years = inflacja[:, 0].astype(int)
    rates = inflacja[:, 1]

    if len(np.unique(years)) != len(years):
        raise ValueError("Powtarzające się lata inflacji.")

    if np.any(~np.isfinite(rates)) or np.any(rates <= -1):
        raise ValueError("Niepoprawne stopy inflacji.")

    inflation_by_year = dict(zip(years, rates))

    X_indexed = np.full_like(X, np.nan)
    inflation_factors = np.full_like(X, np.nan)

    # Współczynnik pełnych poprzednich lat inflacji
    accumulated_factor = 1.0

    for k in range(1, a):

        calendar_year = valuation_year + k

        if calendar_year not in inflation_by_year:
            raise ValueError(
                f"Brak inflacji dla roku {calendar_year}."
            )

        rate = inflation_by_year[calendar_year]

        # Pełne lata poprzednie + pół bieżącego roku
        factor = accumulated_factor * np.sqrt(1.0 + rate)

        # Komórki przypadające na ten rok kalendarzowy
        # Rok szkodowy: valuation_year - (a-1) + i
        for i in range(1, a):
            j = a - 1 - i + k

            if 0 <= j < a:
                if not np.isfinite(X[i, j]):
                    raise ValueError(
                        f"Brak prognozy płatności: "
                        f"wiersz={i}, kolumna={j}."
                    )

                X_indexed[i, j] = X[i, j] * factor
                inflation_factors[i, j] = factor

        # Uwzględnienie pełnego roku w następnych okresach
        accumulated_factor *= 1.0 + rate

    return X_indexed, inflation_factors



h, theta2_I = calculate_parameters_inc(
    L_I=L_I,
    E_I=E_I,
    weights_inc=weights_inc
)

print("Współczynniki h:")
print(h)

print("\nParametry wariancji Incurred:")
print(theta2_I)

print("\nOdchylenia standardowe:")
print(np.sqrt(theta2_I))



g, theta2_R = calculate_parameters_R(
    L_R=L_R,
    E_R=E_R,
    weights_R=weights_inc,
    j_star=15
)

print("Współczynniki g:")
print(g)

print("\nParametry wariancji rezerw:")
print(theta2_R)

print("\nOdchylenia standardowe:")
print(np.sqrt(theta2_R))



lambda_S, r_I, r_R, diagnostics = calculate_lambda(
    X_I=X_I,
    X_R=X_R,
    E_I=E_I,
    E_R=E_R,
    h=h,
    g=g,
    theta2_I=theta2_I,
    theta2_R=theta2_R,
    weights_lambda=weights_inc,
    j_star=15
)

print("Korelacje Spearmana:")
for j, value in enumerate(lambda_S, start=1):
    print(f"j={j:2d} | lambda = {value:.8f}")

print("\nDiagnostyka:")
for j, n, status in diagnostics:
    print(f"j={j:2d} | n={n:2d} | {status}")




import numpy as np
from scipy.stats import spearmanr

W = np.asarray(weights_inc, dtype=float)

print("j  | Nasza lambda | scipy Spearman | Różnica")
print("-" * 58)

for j in range(14):

    n = E_I.shape[0] - j - 1

    selected = (
        (W[:n, j] == 1)
        & np.isfinite(r_I[:n, j])
        & np.isfinite(r_R[:n, j])
    )

    ri = r_I[:n, j][selected]
    rr = r_R[:n, j][selected]

    if len(ri) < 2:
        continue

    scipy_lambda = spearmanr(ri, rr).statistic

    nasza_lambda = lambda_S[j]

    roznica = nasza_lambda - scipy_lambda

    print(
        f"{j+1:2d} | "
        f"{nasza_lambda:12.8f} | "
        f"{scipy_lambda:14.8f} | "
        f"{roznica: .12f}"
    )



X_indexed, inflation_factors = calculate_inflation_paid_incurred(
    X_paid_hat=X_paid_hat,
    inflacja=inflacja,
    valuation_year=2024
)

import pandas as pd

X_indexed_df = pd.DataFrame(
    X_indexed,
    index=paid_df.index,
    columns=paid_df.columns
)


import numpy as np
import pandas as pd
from scipy import stats


def porownaj_rozklady_paid_incurred(
    I, R, E_I, E_R,
    h, g, theta2_I, theta2_R,
    weights_inc,
    weights_R=None,
    max_okres=None,
    n_resamples_ad=100000,
    seed=12345
):
    """
    Ocena dopasowania rozkładów warunkowych Paid-Incurred:
        - normalny
        - gamma
        - lognormalny

    Osobno dla:
        - Incurred
        - rezerw

    Parametry średniej i wariancji są ustalone.
    Nie są ponownie estymowane.

    Testy KS i AD dotyczą reszt PIT względem N(0,1).
    p-value AD wyznaczane metodą Monte Carlo.

    Zwraca:
        tabela_ogolna
        tabela_okresy
        tabela_porownawcza
        reszty_wszystkie
        diagnostyka
    """

    I = np.asarray(I, dtype=np.float64)
    R = np.asarray(R, dtype=np.float64)
    E_I = np.asarray(E_I, dtype=np.float64)
    E_R = np.asarray(E_R, dtype=np.float64)

    h = np.asarray(h, dtype=np.float64)
    g = np.asarray(g, dtype=np.float64)
    theta2_I = np.asarray(theta2_I, dtype=np.float64)
    theta2_R = np.asarray(theta2_R, dtype=np.float64)

    W_I = np.asarray(weights_inc, dtype=np.float64)

    if weights_R is None:
        W_R = W_I.copy()
    else:
        W_R = np.asarray(weights_R, dtype=np.float64)

    a = I.shape[0]

    # ==========================================
    # 1. KONTROLA DANYCH
    # ==========================================

    for name, M in [
        ("I", I),
        ("R", R),
        ("E_I", E_I),
        ("E_R", E_R)
    ]:
        if M.shape != (a, a):
            raise ValueError(
                f"{name} musi mieć wymiar ({a}, {a})."
            )

    for name, x in [
        ("h", h),
        ("g", g),
        ("theta2_I", theta2_I),
        ("theta2_R", theta2_R)
    ]:
        if x.shape != (a - 1,):
            raise ValueError(
                f"Nieprawidłowy wymiar {name}."
            )

    for name, W in [
        ("weights_inc", W_I),
        ("weights_R", W_R)
    ]:
        if W.shape != (a - 1, a - 1):
            raise ValueError(
                f"Nieprawidłowy wymiar {name}."
            )

        if not np.all(np.isin(W, [0, 1])):
            raise ValueError(
                f"{name} musi zawierać 0 lub 1."
            )

    if max_okres is None:
        max_okres = a - 1

    if not 1 <= max_okres <= a - 1:
        raise ValueError("Nieprawidłowy max_okres.")

    if n_resamples_ad is not None:
        if not isinstance(n_resamples_ad, (int, np.integer)):
            raise ValueError("n_resamples_ad musi być całkowite.")

        if n_resamples_ad < 1:
            raise ValueError("n_resamples_ad musi być dodatnie.")

    # ==========================================
    # 2. STATYSTYKA ANDERSONA-DARLINGA
    # ==========================================

    def ad_statistic(z, axis=-1):

        z = np.sort(
            np.asarray(z, dtype=np.float64),
            axis=axis
        )

        n = z.shape[axis]

        log_f = stats.norm.logcdf(z)

        log_sf = stats.norm.logsf(
            np.flip(z, axis=axis)
        )

        k = np.arange(1, n + 1)

        shape = [1] * z.ndim
        shape[axis] = n

        weights = (2 * k - 1).reshape(shape)

        return (
            -n
            - np.sum(
                weights * (log_f + log_sf),
                axis=axis
            ) / n
        )

    # ==========================================
    # 3. TESTY STATYSTYCZNE
    # ==========================================

    def testy(z, rng):

        z = np.asarray(z, dtype=np.float64)

        if len(z) < 2:
            return None

        ks = stats.kstest(
            z,
            "norm",
            args=(0, 1),
            method="auto"
        )

        ad = float(ad_statistic(z))

        if n_resamples_ad is not None:

            mc = stats.monte_carlo_test(
                data=z,
                rvs=lambda size: rng.standard_normal(size),
                statistic=ad_statistic,
                alternative="greater",
                n_resamples=int(n_resamples_ad),
                vectorized=True,
                batch=10000
            )

            p_ad = float(mc.pvalue)

        else:
            p_ad = np.nan

        return {
            "Liczebność próby": len(z),
            "Średnia": np.mean(z),
            "Odchylenie standardowe": np.std(z, ddof=1),
            "Statystyka testowa KS": float(ks.statistic),
            "p-value KS": float(ks.pvalue),
            "Statystyka testowa AD": ad,
            "p-value AD": p_ad
        }

    # ==========================================
    # 4. PRZYGOTOWANIE OBSERWACJI
    # ==========================================

    dane_modeli = {}
    diagnostyka_rows = []

    konfiguracje = [
        ("Incurred", I, E_I, h, theta2_I, W_I),
        ("Rezerwy", R, E_R, g, theta2_R, W_R)
    ]

    for model, X, E, coef, theta2, W in konfiguracje:

        rekordy = []

        for j in range(max_okres):

            n_rows = a - j - 1

            selected = np.flatnonzero(
                W[:n_rows, j] == 1
            )

            if len(selected) == 0:
                diagnostyka_rows.append({
                    "Model": model,
                    "Rok rozwoju": j + 1,
                    "Wybrane wagami": 0,
                    "Do testów": 0,
                    "Wyłączone": 0,
                    "Status": "Brak obserwacji"
                })
                continue

            e = E[selected, j]
            x0 = X[selected, j]
            x1 = X[selected, j + 1]

            # Moment warunkowy:
            # Incurred: I_j + h_j * E_I
            # Rezerwy:  g_j * E_R

            if model == "Incurred":
                mu = x0 + coef[j] * e
            else:
                mu = coef[j] * e

            var = theta2[j] * e

            valid_data = (
                np.isfinite(x0)
                & np.isfinite(x1)
                & np.isfinite(e)
                & np.isfinite(mu)
                & np.isfinite(var)
            )

            valid = (
                valid_data
                & (e > 0)
                & (var > 0)
                & (mu > 0)
            )
            # Reguła odtworzona z wyników referencyjnych zakładu
            if model == "Rezerwy":
                valid = valid & (x1 > 0)
            liczba = int(np.sum(valid))

            if liczba == 0:
                status = "Brak poprawnych momentów"
            elif liczba < 2:
                status = "Zbyt mała próba"
            elif liczba < len(selected):
                status = "Część obserwacji wyłączona"
            else:
                status = "OK"

            diagnostyka_rows.append({
                "Model": model,
                "Rok rozwoju": j + 1,
                "Wybrane wagami": len(selected),
                "Do testów": liczba,
                "Wyłączone": len(selected) - liczba,
                "Zerowa/niedodatnia ekspozycja": int(
                    np.sum(valid_data & (e <= 0))
                ),
                "Niedodatnia wariancja": int(
                    np.sum(valid_data & (var <= 0))
                ),
                "Niedodatnia średnia": int(
                    np.sum(valid_data & (mu <= 0))
                ),
                "Status": status
            })

            for idx in np.flatnonzero(valid):

                rekordy.append({
                    "Indeks roku": int(selected[idx]),
                    "Okres": j + 1,
                    "Obserwacja": x1[idx],
                    "Średnia warunkowa": mu[idx],
                    "Wariancja warunkowa": var[idx]
                })

        dane_modeli[model] = pd.DataFrame(
            rekordy,
            columns=[
                "Indeks roku",
                "Okres",
                "Obserwacja",
                "Średnia warunkowa",
                "Wariancja warunkowa"
            ]
        )

    # ==========================================
    # 5. TRANSFORMACJA PIT
    # ==========================================

    eps = np.finfo(float).eps

    def pit_reszty(dane):

        y = dane["Obserwacja"].to_numpy(dtype=float)
        mu = dane["Średnia warunkowa"].to_numpy(dtype=float)
        var = dane["Wariancja warunkowa"].to_numpy(dtype=float)

        # NORMALNY
        u_normal = stats.norm.cdf(
            y,
            loc=mu,
            scale=np.sqrt(var)
        )

        # GAMMA
        shape_gamma = mu**2 / var
        scale_gamma = var / mu

        u_gamma = stats.gamma.cdf(
            y,
            a=shape_gamma,
            scale=scale_gamma
        )

        # LOGNORMALNY
        sigma_log2 = np.log1p(var / mu**2)
        sigma_log = np.sqrt(sigma_log2)
        mu_log = np.log(mu) - sigma_log2 / 2

        u_lognormal = stats.lognorm.cdf(
            y,
            s=sigma_log,
            scale=np.exp(mu_log)
        )

        res = {}

        for nazwa, u in [
            ("normal", u_normal),
            ("gamma", u_gamma),
            ("lognormal", u_lognormal)
        ]:

            u = np.clip(u, eps, 1.0 - eps)
            res[nazwa] = stats.norm.ppf(u)

        return res

    # ==========================================
    # 6. ANALIZA GLOBALNA I WG OKRESÓW
    # ==========================================

    wiersze_globalne = []
    wiersze_okresy = []
    reszty_lista = []

    rozklady = ["normal", "gamma", "lognormal"]

    for model in ["Incurred", "Rezerwy"]:

        dane = dane_modeli[model]

        if dane.empty:
            continue

        reszty = pit_reszty(dane)

        wynik_reszt = dane[
            ["Indeks roku", "Okres"]
        ].copy()

        wynik_reszt.insert(0, "Model", model)

        for nazwa in rozklady:
            wynik_reszt[nazwa] = reszty[nazwa]

        reszty_lista.append(wynik_reszt)

        for nazwa in rozklady:

            z = np.asarray(reszty[nazwa], dtype=float)
            okresy = dane["Okres"].to_numpy(dtype=int)

            # Globalny test
            if len(z) >= 2:

                rng = np.random.default_rng(seed)

                wynik = testy(z, rng)

                wiersze_globalne.append({
                    "Model": model,
                    "Rozkład": nazwa,
                    **wynik
                })

            # Testy według okresów
            for j in range(1, max_okres + 1):

                z_j = z[okresy == j]

                if len(z_j) < 2:
                    continue

                rng_j = np.random.default_rng(
                    np.random.SeedSequence([
                        seed,
                        0 if model == "Incurred" else 1,
                        rozklady.index(nazwa),
                        j
                    ])
                )

                wynik = testy(z_j, rng_j)

                wiersze_okresy.append({
                    "Model": model,
                    "Rok rozwoju": j,
                    "Rozkład": nazwa,
                    **wynik
                })

    # ==========================================
    # 7. TABELE WYNIKOWE
    # ==========================================

    tabela_porownawcza = pd.DataFrame(
        wiersze_globalne
    )

    if not tabela_porownawcza.empty:
        tabela_porownawcza = (
            tabela_porownawcza
            .sort_values(["Model", "Rozkład"])
            .reset_index(drop=True)
        )

    tabela_ogolna = tabela_porownawcza.copy()

    tabela_okresy = pd.DataFrame(
        wiersze_okresy
    )

    if not tabela_okresy.empty:
        tabela_okresy = (
            tabela_okresy
            .sort_values(
                ["Model", "Rok rozwoju", "Rozkład"]
            )
            .reset_index(drop=True)
        )

    reszty_wszystkie = (
        pd.concat(reszty_lista, ignore_index=True)
        if reszty_lista
        else pd.DataFrame()
    )

    diagnostyka = pd.DataFrame(
        diagnostyka_rows
    )

    # Liczba obserwacji poza nośnikiem
    # rozkładów gamma i lognormalnego
    if not reszty_wszystkie.empty:

        for model in ["Incurred", "Rezerwy"]:

            dane = dane_modeli[model]

            if dane.empty:
                continue

            for j in range(1, max_okres + 1):

                fragment = dane[dane["Okres"] == j]

                mask_diag = (
                    (diagnostyka["Model"] == model)
                    & (diagnostyka["Rok rozwoju"] == j)
                )

                diagnostyka.loc[
                    mask_diag,
                    "Obserwacje <= 0 przy dodatnich momentach"
                ] = int(
                    np.sum(fragment["Obserwacja"] <= 0)
                )

    return (
        tabela_ogolna,
        tabela_okresy,
        tabela_porownawcza,
        reszty_wszystkie,
        diagnostyka
    )



