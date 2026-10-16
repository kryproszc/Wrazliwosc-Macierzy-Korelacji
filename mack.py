"""Kalibracja współczynników rozwoju i wariancji Macka (wersja z wagami 0/1)."""
import numpy as np
 from scipy.optimize import least_squares


def kalibracja_macka(triangle, wagi, wagi_sigma=None):
    C = np.asarray(triangle, dtype=np.float64)
    W = np.asarray(wagi, dtype=np.float64)
    WR = W if wagi_sigma is None else np.asarray(wagi_sigma, dtype=np.float64)
    if C.ndim != 2 or C.shape[0] != C.shape[1]:
        raise ValueError('Trójkąt musi być kwadratowy (a x a).')
    a = C.shape[0]
    if W.shape != (a-1, a-1) or WR.shape != (a-1, a-1):
        raise ValueError(f'Macierze wag muszą mieć rozmiar {(a-1, a-1)}.')
    if not np.isin(W, [0, 1]).all() or not np.isin(WR, [0, 1]).all():
        raise ValueError('Wagi muszą wynosić 0 albo 1.')
    L = np.full((a-1, a-1), np.nan, dtype=np.float64)
    f = np.full(a-1, np.nan, dtype=np.float64)
    fr = np.full(a-1, np.nan, dtype=np.float64)
    sigma2 = np.full(a-1, np.nan, dtype=np.float64)
    nf = np.zeros(a-1, dtype=np.int64)
    ns = np.zeros(a-1, dtype=np.int64)
    for j in range(a-1):
        n = a-j-1
        cur, nxt = C[:n, j], C[:n, j+1]
        valid = np.isfinite(cur) & np.isfinite(nxt) & (cur > 0)
        if np.any(((W[:n,j] == 1) | (WR[:n,j] == 1)) & ~valid):
            raise ValueError(f'Nieprawidłowe dane lub C<=0 w okresie {j+1} przy wadze 1.')
        L[:n,j][valid] = nxt[valid] / cur[valid]
        wf = valid & (W[:n,j] == 1)
        wr = valid & (WR[:n,j] == 1)
        nf[j], ns[j] = int(wf.sum()), int(wr.sum())
        if nf[j] > 0:
            f[j] = np.sum(nxt[wf]) / np.sum(cur[wf])
        if ns[j] > 0:
            fr[j] = np.sum(nxt[wr]) / np.sum(cur[wr])
        if ns[j] > 1:
            sigma2[j] = np.sum(cur[wr] * (L[:n,j][wr] - fr[j])**2) / (ns[j]-1)
    # Wariant specjalny dokumentacji dotyczy wyłącznie ostatniego okresu (j=a-1).
    # Jeśli wcześniejsze wariancje są niedostępne, nie dokonujemy automatycznej ekstrapolacji.
    if (a >= 4 and np.isfinite(sigma2[-2]) and np.isfinite(sigma2[-3])
            and sigma2[-3] > 0):
        sigma2[-1] = min(sigma2[-2]**2/sigma2[-3], sigma2[-3], sigma2[-2])
    return L, f, fr, sigma2, nf, ns


def wypisz_wyniki(f, sigma2, nf, ns):
    print(f"{'Okres':>6} {'Liczba f':>10} {'f':>16} {'Liczba sigma':>14} {'sigma^2':>22}")
    for j in range(len(f)):
        print(f'{j+1:6d} {nf[j]:10d} {f[j]:16.9f} {ns[j]:14d} {sigma2[j]:22.6f}')


def calculate_C_future(triangle, f):
    import numpy as np

    a = triangle.shape[0]
    C_future = triangle.copy()

    for i in range(1, a):
        j_start = a - i

        for j in range(j_start, a):
            C_future[i, j] = C_future[i, j - 1] * f[j - 1]

    return C_future






def krzywa_ldf(j, b0, b1, curve_type="weibull"):

    j = np.asarray(j, dtype=np.float64)

    if curve_type == "exponential":
        return 1.0 + np.exp(b0 + b1 * j)

    elif curve_type == "inverse_power":
        return 1.0 + np.exp(b0) * j**b1

    elif curve_type == "weibull":
        return 1.0 / (
            1.0 - np.exp(-np.exp(b0) * j**b1)
        )

    else:
        raise ValueError("Nieznany typ krzywej")


def dopasuj_ldf(
    ldf_base,
    v=None,
    curve_type="weibull",
    fit_from=4,
    fit_to=15,
    smooth_from=4,
    smooth_to=None,
    tail_length=5
):

    ldf_base = np.asarray(ldf_base, dtype=np.float64)
    n = len(ldf_base)

    if smooth_to is None:
        smooth_to = n

    okresy = np.arange(fit_from, fit_to + 1)
    y = ldf_base[okresy - 1]

    if v is None:
        w = np.ones(len(okresy), dtype=np.float64)
    else:
        v = np.asarray(v, dtype=np.float64)
        if len(v) != n:
            raise ValueError("Wektor v ma nieprawidłową długość")
        w = v[okresy - 1]

    mask = (
        np.isfinite(y)
        & (y > 1.0)
        & np.isfinite(w)
        & (w > 0.0)
    )

    j_fit = okresy[mask]
    y_fit = y[mask]
    w_fit = w[mask]

    if len(j_fit) < 3:
        raise ValueError("Potrzeba minimum 3 obserwacji do regresji")

    # Normalizacja wag nie zmienia minimum funkcji celu
    w_fit = w_fit / np.mean(w_fit)

    if curve_type == "weibull":
        x0 = np.array([0.5, 0.5])
        bounds = ([-20.0, 1e-8], [20.0, 10.0])

    elif curve_type == "exponential":
        x0 = np.array([-2.0, -0.2])
        bounds = ([-30.0, -10.0], [20.0, -1e-8])

    elif curve_type == "inverse_power":
        x0 = np.array([-2.0, -2.0])
        bounds = ([-30.0, -20.0], [20.0, -1e-8])

    else:
        raise ValueError("Nieznany typ krzywej")

    def reszty(parametry):
        b0, b1 = parametry
        prognoza = krzywa_ldf(j_fit, b0, b1, curve_type)

        return np.sqrt(w_fit) * (y_fit - prognoza)

    wynik = least_squares(
        reszty,
        x0=x0,
        bounds=bounds,
        max_nfev=20000,
        ftol=1e-13,
        xtol=1e-13,
        gtol=1e-13
    )

    if not wynik.success:
        raise RuntimeError(wynik.message)

    b0, b1 = wynik.x

    print(b0,b1)
    # Wygładzanie
    ldf = ldf_base.copy()

    j_smooth = np.arange(smooth_from, smooth_to + 1)

    ldf[j_smooth - 1] = krzywa_ldf(
        j_smooth, b0, b1, curve_type
    )

    # Ogon: dla 22 okresów LDF jest ich 21,
    # zatem ogon zaczyna się od j=22.
    if tail_length == 0:
        tail = 1.0
    else:
        j_tail = np.arange(n + 1, n + 1 + tail_length)
        tail = float(np.prod(
            krzywa_ldf(j_tail, b0, b1, curve_type)
        ))

    return ldf, b0, b1, tail, wynik



import numpy as np
from scipy.optimize import least_squares


def dopasuj_sigma(
    sigma2,
    curve_type="weibull",
    fit_from=5,
    fit_to=14,
    smooth_from=5,
    smooth_to=21,
    v=None
):
    sigma2 = np.asarray(sigma2, dtype=np.float64)
    n = len(sigma2)

    if not (1 <= fit_from <= fit_to <= n):
        raise ValueError("Nieprawidlowy zakres dopasowania")

    if not (1 <= smooth_from <= smooth_to <= n):
        raise ValueError("Nieprawidlowy zakres wygladzania")

    j = np.arange(fit_from, fit_to + 1)
    y = sigma2[j - 1]

    if v is None:
        w = np.ones(n, dtype=np.float64)
    else:
        w = np.asarray(v, dtype=np.float64)

        if len(w) != n:
            raise ValueError("Nieprawidlowa dlugosc wag")

    w_fit = w[j - 1]

    mask = (
        np.isfinite(y) & (y > 0) &
        np.isfinite(w_fit) & (w_fit > 0)
    )

    j_fit = j[mask]
    y_fit = y[mask]
    w_fit = w_fit[mask]

    if len(j_fit) < 3:
        raise ValueError("Za malo obserwacji do regresji")

    def curve(j, b):
        j = np.asarray(j, dtype=np.float64)
        b0, b1 = b

        if curve_type == "exponential":
            return np.exp(b0 + b1 * j)

        elif curve_type == "power":
            return np.exp(b0 + b1 * np.log(j))

        elif curve_type == "weibull":
            z = np.exp(b0 + b1 * np.log(j))
            return 1.0 / np.expm1(z)

        else:
            raise ValueError("Nieznany curve_type")

    if curve_type == "exponential":
        x0 = np.polyfit(j_fit, np.log(y_fit), 1)[::-1]
        bounds = ([-100, -100], [100, 100])

    elif curve_type == "power":
        x0 = np.polyfit(
            np.log(j_fit), np.log(y_fit), 1
        )[::-1]
        bounds = ([-100, -100], [100, 100])

    elif curve_type == "weibull":
        # Inicjalizacja z transformacji Weibulla:
        # log(log(1 + 1 / sigma2)) = b0 + b1 * log(j)
        transformed = np.log(np.log1p(1.0 / y_fit))

        x0 = np.polyfit(
            np.log(j_fit), transformed, 1
        )[::-1]

        bounds = ([-100, 0.001], [100, 10])

    else:
        raise ValueError("Nieznany curve_type")

    scale = np.median(y_fit)
    weights = np.sqrt(w_fit / np.mean(w_fit))

    def residuals(b):
        return weights * (curve(j_fit, b) - y_fit) / scale

    wynik = least_squares(
        residuals,
        x0=x0,
        bounds=bounds,
        max_nfev=20000,
        ftol=1e-12,
        xtol=1e-12,
        gtol=1e-12
    )

    if not wynik.success:
        raise RuntimeError(wynik.message)

    b0, b1 = wynik.x

    sigma2_fit = sigma2.copy()

    j_smooth = np.arange(
        smooth_from,
        smooth_to + 1
    )

    sigma2_fit[j_smooth - 1] = curve(
        j_smooth,
        wynik.x
    )

    return sigma2_fit, b0, b1, wynik


def calculate_paid_fit(
    triangle,
    ldf,
    tail,
    inflacja=None,
    discount_factors=None,
    start_year=2003
):

    C = np.asarray(triangle, dtype=np.float64)
    ldf = np.asarray(ldf, dtype=np.float64)
    tail = float(tail)

    a = C.shape[0]
    end_year = start_year + a - 1

    if C.shape != (a, a):
        raise ValueError("Trójkąt musi być kwadratowy.")

    if ldf.shape != (a - 1,):
        raise ValueError(f"Potrzeba {a-1} współczynników LDF.")

    # ==========================================
    # 0. INFLACJA
    # ==========================================

    if inflacja is None:
        inflation_dict = {}
    else:
        inflacja = np.asarray(inflacja, dtype=np.float64)

        if inflacja.ndim != 2 or inflacja.shape[1] != 2:
            raise ValueError(
                "Inflacja musi mieć kolumny: rok, stopa."
            )

        inflation_dict = {
            int(year): float(rate)
            for year, rate in inflacja
        }

    def inflation_factor(year):
        if inflacja is None:
            return 1.0

        factor = 1.0

        for y in range(end_year + 1, year):
            factor *= 1.0 + inflation_dict[y]

        factor *= np.sqrt(1.0 + inflation_dict[year])

        return factor

    # ==========================================
    # 1. ROZWINIĘCIE TRÓJKĄTA SKUMULOWANEGO
    # ==========================================

    C_hat = C.copy()

    for i in range(a):
        last = a - i - 1

        for j in range(last + 1, a):
            C_hat[i, j] = C_hat[i, j-1] * ldf[j-1]

    # ==========================================
    # 2. TRÓJKĄT INKREMENTALNY
    # ==========================================

    X_fit = np.full((a, a + 1), np.nan)

    for i in range(a):
        for j in range(a):

            if j == 0:
                if np.isfinite(C[i, 0]):
                    X_fit[i, j] = C[i, 0]
                continue

            incremental = C_hat[i, j] - C_hat[i, j-1]

            if np.isfinite(C[i, j]):
                # Historia bez dodatkowej inflacji
                X_fit[i, j] = incremental
            else:
                # Prognoza z opcjonalną inflacją
                year = start_year + i + j

                X_fit[i, j] = (
                    incremental * inflation_factor(year)
                )

    # ==========================================
    # 3. OGON
    # ==========================================

    for i in range(a):

        year = start_year + i + a

        X_fit[i, a] = (
            C_hat[i, -1]
            * (tail - 1.0)
            * inflation_factor(year)
        )

    # ==========================================
    # 4. BEL
    # ==========================================

    # Rok kalendarzowy każdej wypłaty
    years = (
        start_year
        + np.arange(a)[:, None]
        + np.arange(a + 1)[None, :]
    )

    # Uwzględniamy tylko przyszłe wypłaty
    future_mask = years > end_year

    future_paid = np.where(
        future_mask,
        X_fit,
        0.0
    )

    # Opcjonalne dyskontowanie
    if discount_factors is None:
        BEL = float(np.sum(future_paid))

    else:
        discount_factors = np.asarray(
            discount_factors,
            dtype=np.float64
        )

        if discount_factors.ndim != 1:
            raise ValueError(
                "discount_factors musi być wektorem 1D."
            )

        # 2025 -> indeks 0, 2026 -> indeks 1 itd.
        discount_idx = years - end_year - 1

        if np.any(
            discount_idx[future_mask] >= len(discount_factors)
        ):
            raise ValueError(
                "Za krótki wektor discount_factors."
            )

        if not np.all(np.isfinite(discount_factors)):
            raise ValueError(
                "discount_factors zawiera NaN lub inf."
            )

        df_matrix = np.ones_like(X_fit)

        df_matrix[future_mask] = discount_factors[
            discount_idx[future_mask]
        ]

        BEL = float(np.sum(future_paid * df_matrix))

    # ==========================================
    # 5. WYNIK
    # ==========================================

    return X_fit, BEL



##########
#incurred

def calculate_h(L_I, E_I, weights_inc):
    """
    Estymacja współczynników h_j modelu Paid-Incurred.

    Parametry
    ---------
    L_I : ndarray (a, a-1)
        Indywidualne współczynniki rozwoju Incurred.

    E_I : ndarray (a, a)
        Nośniki ryzyka Incurred.

    weights_inc : ndarray (a-1, a-1)
        Macierz wag 0/1.

    Zwraca
    -------
    h : ndarray (a-1,)
        Oszacowane współczynniki rozwoju h_j.
    """

    L_I = np.asarray(L_I, dtype=np.float64)
    E_I = np.asarray(E_I, dtype=np.float64)
    weights_inc = np.asarray(weights_inc, dtype=np.float64)

    a = E_I.shape[0]

    if E_I.shape != (a, a):
        raise ValueError("Macierz E_I musi mieć wymiar (a, a).")

    if L_I.shape != (a, a - 1):
        raise ValueError("Macierz L_I musi mieć wymiar (a, a-1).")

    if weights_inc.shape != (a - 1, a - 1):
        raise ValueError("Macierz wag musi mieć wymiar (a-1, a-1).")

    if not np.all(np.isin(weights_inc, [0, 1])):
        raise ValueError("Macierz wag musi zawierać wyłącznie 0 i 1.")

    h = np.full(a - 1, np.nan, dtype=np.float64)

    for j in range(a - 1):

        # i = 1, ..., a-j-1 (indeksowanie Python)
        n = a - j - 1

        E_j = E_I[:n, j]
        L_j = L_I[:n, j]
        w_j = weights_inc[:n, j]

        # Obserwacje uwzględniane w estymacji
        selected = w_j == 1

        # Wykluczamy niepoprawne dane, zamiast liczyć NaN * 0
        if np.any(selected & (~np.isfinite(E_j) | ~np.isfinite(L_j))):
            raise ValueError(
                f"Niepoprawne dane dla okresu rozwoju j={j+1}."
            )

        denominator = np.sum(E_j[selected])
        numerator = np.sum(E_j[selected] * L_j[selected])

        # Warunek z dokumentacji
        if denominator <= 0:
            raise ValueError(
                f"Nie jest spełniony warunek dodatniego mianownika "
                f"dla j={j+1}."
            )

        h[j] = numerator / denominator

    return h



def calculate_variance_inc(L_I, E_I, weights_inc, weights_var_inc=None):
    """
    Estymacja parametrów wariancji modelu Paid-Incurred
    dla szkód zgłoszonych (Incurred).

    Zwraca:
    --------
    theta2 : ndarray (a-1,)
        Parametry wariancji vartheta_j^2.

    h_r : ndarray (a-1,)
        Średnie h_j^r wyznaczone z wag wariancyjnych.
        Ostatni element = NaN.

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

    if weights_var_inc.shape != (a - 1, a - 1):
        raise ValueError("Wagi muszą mieć wymiar (a-1, a-1).")

    if not np.all(np.isin(weights_var_inc, [0, 1])):
        raise ValueError("Wagi muszą zawierać tylko 0 i 1.")

    theta2 = np.full(a - 1, np.nan)
    h_r = np.full(a - 1, np.nan)

    # j = 1, ..., a-2
    for j in range(a - 2):

        n = a - j - 1

        E_j = E_I[:n, j]
        L_j = L_I[:n, j]
        w_j = weights_var_inc[:n, j]

        selected = w_j == 1

        # Liczba obserwacji uwzględnionych
        N = np.sum(selected)

        if N <= 1:
            raise ValueError(
                f"Okres j={j+1}: liczba obserwacji <= 1. "
                "Dokumentacja wymaga ekstrapolacji."
            )

        E_sel = E_j[selected]
        L_sel = L_j[selected]

        if not np.all(np.isfinite(E_sel)):
            raise ValueError(
                f"Okres j={j+1}: niepoprawne wartości E_I."
            )

        if not np.all(np.isfinite(L_sel)):
            raise ValueError(
                f"Okres j={j+1}: niepoprawne wartości L_I."
            )

        if np.any(E_sel < 0):
            raise ValueError(
                f"Okres j={j+1}: ujemny nośnik ryzyka."
            )

        # Średnia h_j^r
        denominator_h = np.sum(E_sel)

        if denominator_h <= 0:
            raise ValueError(
                f"Okres j={j+1}: niedodatni mianownik h_r."
            )

        h_r[j] = np.sum(E_sel * L_sel) / denominator_h

        # Parametr wariancji
        numerator = np.sum(
            (L_sel - h_r[j])**2 * E_sel
        )

        theta2[j] = numerator / (N - 1)

    # Ostatni parametr wariancji
    if not np.all(np.isfinite(theta2[-3:-1])):
        raise ValueError(
            "Brak dwóch poprzednich parametrów wariancji."
        )

    if theta2[-3] <= 0:
        raise ValueError(
            "Nie można zastosować wzoru na ostatni "
            "parametr: theta2[a-3] <= 0."
        )

    theta2[-1] = min(
        theta2[-2]**2 / theta2[-3],
        theta2[-3],
        theta2[-2]
    )

    return theta2, h_r