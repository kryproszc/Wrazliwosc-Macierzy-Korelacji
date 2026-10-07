
from typing import Iterable, Sequence
import time

import numpy as np
import pandas as pd
from numba import njit, prange

### do CL

# ---------------------------------------------------------------------------
# Helper functions (Numba‑accelerated)
# ---------------------------------------------------------------------------
@njit
def vector_reverse_diagonal(data: np.ndarray):
    """Zwraca wektor elementów odwrotnej przekątnej (ostatniej pełnej diagonali)."""
    rows, cols = data.shape
    result = []
    for i in range(rows):
        j = cols - 1 - i
        if 0 <= j < cols:
            v = data[i, j]
            if not np.isnan(v):
                result.append(v)
    return np.array(result)

@njit
def sum_reverse_diagonal(data: np.ndarray) -> float:
    """Suma odwrotnej przekątnej (ostatniej pełnej diagonali)."""
    tot = 0.0
    rows, cols = data.shape
    for i in range(rows):
        j = cols - 1 - i
        if 0 <= j < cols:
            v = data[i, j]
            if not np.isnan(v):
                tot += v
    return tot


@njit
def Dev_prem(data_paid: np.ndarray, wagi: np.ndarray) -> np.ndarray:
    n_row, n_col = data_paid.shape
    dev = np.empty(n_col - 1)
    for j in range(n_col - 1):
        num = den = 0.0
        for i in range(n_row):
            val_curr = data_paid[i, j]
            val_next = data_paid[i, j + 1]
            w = wagi[i, j]
            if not (np.isnan(val_next)):
                num += val_next * w
                den += val_curr * w
        dev[j] = num / den if den != 0.0 else 1.0
    return dev


@njit
def elementwise_division(data_paid: np.ndarray) -> np.ndarray:

    n_rows, n_cols = data_paid.shape
    out = np.empty((n_rows, n_cols - 1))
    for i in range(n_rows):
        for j in range(n_cols - 1):
            a = data_paid[i, j]
            b = data_paid[i, j + 1]
            if a != 0.0 and not np.isnan(b):
                val = b / a
                out[i, j] = val if np.isfinite(val) else 1.0
            else:
                out[i, j] = 1.0
    return out

@njit
def calculate_sigma(p_ij, l_ij, w_ij, dev_j):
    n_rows, n_cols = l_ij.shape
    sigmas = []
    sds = []
    
    for j in range(n_cols):
        dev = dev_j[j]
        num = den = den_sd = 0.0
        
        for i in range(n_rows):
            w = w_ij[i, j]
            p = p_ij[i, j]
            l = l_ij[i, j]
            
            # Sprawdź czy wszystkie wartości są prawidłowe (nie NaN)
            if not (np.isnan(w) or np.isnan(p) or np.isnan(l)):
                diff = l - dev
                num += w * p * diff * diff
                den += w
                den_sd += w * p
        
        # Oblicz sigma zgodnie z oryginalną logiką
        if den > 1:
            sigma = num / (den - 1.0)
            sd_val = sigma / den_sd if den_sd > 0 else 0.0
        elif j == (n_cols - 1) and len(sigmas) >= 2 and sigmas[j-2] != 0 and den_sd != 0:
            # Specjalna logika dla ostatniej kolumny
            sigma = min(sigmas[j-1]**4 / sigmas[j-2]**2, min(sigmas[j-2]**2, sigmas[j-1]**2))
            sd_val = sigma / den_sd
        else:
            sigma = 0.0
            sd_val = 0.0
        
        sigmas.append(sigma)
        sds.append(sd_val)
    
    return sigmas, sds



@njit
def choose_value_list(vec_input, vec_wykluczenia, a, b):
    count = 0
    for k in range(len(vec_wykluczenia)):
        idx = vec_wykluczenia[k] - 1
        val = vec_input[idx]
        if a < val < b:
            count += 1

    out_vals = np.empty(count)
    out_inds = np.empty(count, dtype=np.int64)

    pos = 0
    for k in range(len(vec_wykluczenia)):
        idx = vec_wykluczenia[k] - 1
        val = vec_input[idx]
        if a < val < b:
            out_vals[pos] = val
            out_inds[pos] = idx
            pos += 1

    return out_vals, out_inds

@njit
def fit_curve_factor_cl(data_input, sd_input, x_k):
    n = len(data_input)
    se2 = sd_input 
    w = np.empty(n)
    for i in range(n):
        denom = (data_input[i] - 1) ** 2
        w[i] = 1.0 / np.sqrt(np.log(1.0 + se2[i] / denom)) if denom > 0.0 else 0
    y = np.log(data_input - 1.0)
    A = A_x = A_xx = A_y = A_xy = 0.0
    for i in range(n):
        wi = w[i]
        xi = x_k[i]
        yi = y[i]
        A += wi
        A_x += wi * xi
        A_xx += wi * xi * xi
        A_y += wi * yi
        A_xy += wi * xi * yi
    Delta = A * A_xx - A_x * A_x
    if Delta == 0.0:
        return 0.0, 0.0
    a_coef = (A * A_xy - A_x * A_y) / Delta
    b_coef = (A_xx * A_y - A_x * A_xy) / Delta
    return a_coef, b_coef

@njit
def wspolczynnik_reg_factor_cl(a_coef, b_coef, k_start, k_stop):
    n = k_stop - k_start + 1
    out = np.empty(n)
    for i in range(n):
        k = k_start + i
        out[i] = 1.0 + np.exp(a_coef * k + b_coef)
    return out


@njit
def wspolczynnik_reg_factor_P_to_I(a_coef, b_coef, k_start, k_stop):
    k_values = np.arange(k_start, k_stop + 1)
    exponent = np.exp(a_coef * k_values + b_coef)
    wartosci_reg = 1.0 - exponent
    return wartosci_reg


@njit
def triangle_forward_one_np(triangle_input, f, k_forward_start):
    mm, nn = triangle_input.shape
    req_cols = len(f) + 1
    tri = np.zeros((mm, req_cols))
    # kopiuj istniejące dane
    for i in range(mm):
        for j in range(nn):
            tri[i, j] = triangle_input[i, j]
    # projekcja
    for j in range(k_forward_start - 1, len(f)):
        if j + 1 >= req_cols:
            continue
        max_row = max(0, mm - j - 1)
        for i in range(max_row, mm):
            tri[i, j + 1] = tri[i, j] * f[j]
    return tri





####

@njit
def vector_reverse_diagonal(data: np.ndarray):
    """Zwraca wektor elementów odwrotnej przekątnej (ostatniej pełnej diagonali)."""
    rows, cols = data.shape
    result = []
    for i in range(rows):
        j = cols - 1 - i
        if 0 <= j < cols:
            v = data[i, j]
            if not np.isnan(v):
                result.append(v)
    return np.array(result)


@njit
def _build_base_triangle_cladd(data_paid, n_dev):
    """
    Buduje bazę trójkąta o wymiarze (mm, n_dev+1) kopiując dane
    i dopełniając NaN.
    """
    mm, n_cols_orig = data_paid.shape
    total_cols = n_dev + 1
    base = np.empty((mm, total_cols), dtype=np.float64)

    for i in range(mm):
        for j in range(total_cols):
            if j < n_cols_orig:
                base[i, j] = data_paid[i, j]
            else:
                base[i, j] = np.nan
    return base


@njit
def transform_data_cladd(data_input, exposure):
    """
    Transformacja do LR-inkrementów:
    col0: C_{i,0} / exposure[i]
    colj: (C_{i,j}-C_{i,j-1}) / exposure[i]
    """
    n, m = data_input.shape
    data_input = data_input[:, :(n + 1)]

    output = np.empty((n, m))

    for i in range(n):
        output[i, 0] = data_input[i, 0] / exposure[i]

    for j in range(1, m):
        for i in range(n):
            if not np.isnan(data_input[i, j]):
                output[i, j] = (data_input[i, j] - data_input[i, j - 1]) / exposure[i]

    return output

#######################

@njit
def choose_value_list(vec_input, vec_wykluczenia, a, b):
    """
    Wybiera wartości z vec_input wg indeksów w vec_wykluczenia (1-based),
    filtrując do przedziału (a, b). Zwraca (wartosci, indeksy_0based).
    """
    count = 0
    for k in range(len(vec_wykluczenia)):
        idx = vec_wykluczenia[k] - 1
        val = vec_input[idx]
        if a < val < b:
            count += 1

    out_vals = np.empty(count)
    out_inds = np.empty(count, dtype=np.int64)

    pos = 0
    for k in range(len(vec_wykluczenia)):
        idx = vec_wykluczenia[k] - 1
        val = vec_input[idx]
        if a < val < b:
            out_vals[pos] = val
            out_inds[pos] = idx
            pos += 1

    return out_vals, out_inds


@njit(fastmath=False)
def fit_curve_factor_lr(data_input, sd_input, x_k):
    """
    Dopasowanie krzywej: log(y)=a*k+b, gdzie y=data_input.
    Wagi zależą od błędu (sd_input).
    Zwraca (a_coef, b_coef).
    """
    n = len(data_input)
    se2 = sd_input ** 2
    w = np.empty(n)

    for i in range(n):
        denom = data_input[i] ** 2
        w_mian = np.sqrt(np.log(1.0 + se2[i] / denom)) if denom != 0.0 else 0.0
        if w_mian != 0.0:
            w[i] = 1.0 / w_mian
        else:
            w[i] = 0.0

    y = np.empty(n)
    for i in range(n):
        if data_input[i] > 0.0:
            y[i] = np.log(data_input[i])
        else:
            y[i] = 0.0

    A = A_x = A_xx = A_y = A_xy = 0.0
    for i in range(n):
        wi = w[i]
        xi = x_k[i]
        yi = y[i]
        A += wi
        A_x += wi * xi
        A_xx += wi * xi * xi
        A_y += wi * yi
        A_xy += wi * xi * yi

    Delta = A * A_xx - A_x * A_x
    if Delta == 0.0:
        return 0.0, 0.0

    a_coef = (A * A_xy - A_x * A_y) / Delta
    b_coef = (A_xx * A_y - A_x * A_xy) / Delta
    return a_coef, b_coef


@njit
def wspolczynnik_reg_factor_lr(a_coef, b_coef, k_start, k_stop):
    """
    Ogon: exp(a*k+b) dla k=k_start..k_stop (włącznie).
    """
    n = k_stop - k_start + 1
    out = np.empty(n)
    for i in range(n):
        k = k_start + i
        out[i] = np.exp(a_coef * k + b_coef)
    return out


@njit
def _build_base_triangle(data_paid, n_dev):
    """
    Buduje bazę trójkąta o wymiarze (mm, n_dev+1) kopiując dane
    i dopełniając NaN.
    """
    mm, n_cols_orig = data_paid.shape
    total_cols = n_dev + 1
    base = np.empty((mm, total_cols), dtype=np.float64)

    for i in range(mm):
        for j in range(total_cols):
            if j < n_cols_orig:
                base[i, j] = data_paid[i, j]
            else:
                base[i, j] = np.nan
    return base


@njit
def triangle_forward_loss_ratio_numba(tri_in, LR_j, exposure, k_forward):
    """
    Projekcja LR: C_{i,j+1} = C_{i,j} + exposure[i] * LR_j[j]
    """
    mm, n_cols_orig = tri_in.shape
    n_cols_out = max(n_cols_orig, len(LR_j) + 1)

    tri = np.empty((mm, n_cols_out), dtype=np.float64)
    tri[:] = np.nan

    for i in range(mm):
        for j in range(n_cols_orig):
            tri[i, j] = tri_in[i, j]

    for j in range(k_forward):
        max_ind_row = 1 if (mm - j) < 1 else (mm - j)
        start_row = max_ind_row - 1
        for i in range(start_row, mm):
            base_val = tri[i, j]
            tri[i, j + 1] = base_val + exposure[i] * LR_j[j]

    return tri


@njit
def sum_reverse_diagonal(data):
    """
    Suma elementów odwrotnej przekątnej (ostatniej pełnej diagonali).
    """
    tot = 0.0
    rows, cols = data.shape
    for i in range(rows):
        j = cols - 1 - i
        if 0 <= j < cols:
            v = data[i, j]
            if not np.isnan(v):
                tot += v
    return tot


@njit
def vector_reverse_diagonal(data):
    """
    Zwraca wektor elementów odwrotnej przekątnej (ostatniej pełnej diagonali).
    """
    rows, cols = data.shape
    result = []
    for i in range(rows):
        j = cols - 1 - i
        if 0 <= j < cols:
            v = data[i, j]
            if not np.isnan(v):
                result.append(v)
    return np.array(result)


@njit
def transform_data(data_input, exposure):
    """
    Transformacja do LR-inkrementów:
    col0: C_{i,0} / exposure[i]
    colj: (C_{i,j}-C_{i,j-1}) / exposure[i]
    """
    n, m = data_input.shape
    data_input = data_input[:, :(n + 1)]

    output = np.empty((n, m))

    for i in range(n):
        output[i, 0] = data_input[i, 0] / exposure[i]

    for j in range(1, m):
        for i in range(n):
            if not np.isnan(data_input[i, j]):
                output[i, j] = (data_input[i, j] - data_input[i, j - 1]) / exposure[i]

    return output


@njit
def wspolczynnik_LR(data_LR, w, exposure):
    """
    LR_j = sum_i(lr_ij * w_ij * e_i) / sum_i(w_ij * e_i)
    """
    n, m = data_LR.shape
    wsp_LR = np.empty(m)

    for j in range(m):
        numerator = 0.0
        denominator = 0.0

        for i in range(n):
            lr_ij = data_LR[i, j]
            w_ij = w[i, j]
            e_i = exposure[i]

            if not np.isnan(lr_ij) and not np.isnan(w_ij) and not np.isnan(e_i) and w_ij > 0.0:
                numerator += lr_ij * w_ij * e_i
                denominator += w_ij * e_i

        if denominator == 0.0:
            wsp_LR[j] = 0.0
        else:
            wsp_LR[j] = numerator / denominator

    return wsp_LR


@njit
def sigma_LR(data_LR, w, exposure, wsp_LR):
    """
    Sigma dla LR (wariancja ważona): sum(w*e*(lr-mean)^2)/(sum(w)-1)
    """
    n, m = data_LR.shape
    sigma_j = np.empty(m)
    for j in range(m):
        sum_num = 0.0
        sum_denom = 0.0
        mean_j = wsp_LR[j]
        for i in range(n):
            lr = data_LR[i, j]
            wij = w[i, j]
            ei = exposure[i]
            if not np.isnan(wij) and wij>0.0  :
                sum_num += wij * ei * (lr - mean_j) ** 2
                sum_denom += wij
        if sum_denom > 1.0:
            sigma_j[j] = sum_num / (sum_denom - 1.0)
        else:
            sigma_j[j] = 0.0
    return sigma_j


@njit
def wspolczynnik_sd(wsp_sigma, w, exposure):
    """
    sd_j = sqrt( sigma_j / sum_i(w_ij * e_i) )
    """
    n, m = w.shape
    sd_j = np.empty(m)

    for j in range(m):
        denominator = 0.0
        for i in range(n):
            wij = w[i, j]
            ei = exposure[i]
            if not np.isnan(wij):
                denominator += wij * ei

        if denominator == 0.0 or wsp_sigma[j] == 0.0:
            sd_j[j] = 0.0
        else:
            sd_j[j] = np.sqrt(wsp_sigma[j] / denominator)

    return sd_j



@njit
def fit_curve_factor_P_to_I(data_input, x_k):
    factor_input = np.log(1.0 - data_input)
    w_k_sqr = np.ones(len(data_input))

    A = np.sum(w_k_sqr)
    A_x = np.sum(w_k_sqr * x_k)
    A_xx = np.sum(w_k_sqr * x_k * x_k)
    A_y = np.sum(w_k_sqr * factor_input)
    A_xy = np.sum(w_k_sqr * x_k * factor_input)

    Delta = A * A_xx - A_x * A_x
    a_num = (A * A_xy - A_x * A_y) / Delta
    b_num = (A_xx * A_y - A_x * A_xy) / Delta

    return a_num, b_num


@njit
def run_simulation_addcl_numba_incurred(
        dev_inc, sigma_inc, sd_inc,
        rj, varj, r_i_j, lambda_cor,
        data_paid_np, data_inc_np, weights_np, wykluczenia,
        Poz_CL, data_wagi_pi, wykluczenia_p_i,
        Poz_CL_p_i, dop_ogo_p_i,
        il_ogon, discount_factors, net_to_gross,
        sigma_inc_LR, dev_inc_LR, sd_inc_LR,
        e_values, wagi_trimmed_LR,
        ilosc_dop_wsp_LR, Poz_LR, il_ogon_LR,
        k_zmiana,
        sim_total=1, batch_sim=1, main_seed=202260011):


    latest = vector_reverse_diagonal(data_paid_np)
    mm, n_cols_orig = data_paid_np.shape
    n_dev = len(dev_inc)

    # ---------------------------------------------------------
    # Walidacja trybu ADD / CL
    # ---------------------------------------------------------
    if k_zmiana < 0 or k_zmiana > n_dev:
        raise ValueError(
            "k_zmiana musi należeć do przedziału 0..len(dev_inc)"
        )

    # k_zmiana == 0 -> czysty CL. Parametry LR mogą być puste.
    if k_zmiana > 0:
        if len(dev_inc_LR) < k_zmiana:
            raise ValueError(
                "Dla k_zmiana > 0 dev_inc_LR musi zawierać co najmniej k_zmiana elementów."
            )
        if len(sigma_inc_LR) < k_zmiana:
            raise ValueError(
                "Dla k_zmiana > 0 sigma_inc_LR musi zawierać co najmniej k_zmiana elementów."
            )
        if len(sd_inc_LR) < k_zmiana:
            raise ValueError(
                "Dla k_zmiana > 0 sd_inc_LR musi zawierać co najmniej k_zmiana elementów."
            )
        if len(e_values) < mm:
            raise ValueError(
                "Dla k_zmiana > 0 e_values musi zawierać co najmniej mm elementów."
            )
        if wagi_trimmed_LR.shape[0] == 0 or wagi_trimmed_LR.shape[1] == 0:
            raise ValueError(
                "Dla k_zmiana > 0 wagi_trimmed_LR nie może być puste."
            )

    # ---------------------------------------------------------
    # Bezpieczne discount_factors i net_to_gross
    # ---------------------------------------------------------
    discount_factors_safe = np.ones(n_dev)
    up_to = min(len(discount_factors), n_dev)
    for ii in range(up_to):
        discount_factors_safe[ii] = discount_factors[ii]

    net_to_gross_safe = np.ones(mm)
    up_to = min(len(net_to_gross), mm)
    for ii in range(up_to):
        net_to_gross_safe[ii] = net_to_gross[ii]

    r_j_sim_mean = np.zeros(n_cols_orig)
    r_j_sim = np.zeros((sim_total, n_cols_orig))

    # Trochę zapasu na projekcję z ogonem.
    max_cols = n_dev + max(il_ogon, il_ogon_LR) + 3
    all_incurred_triangles = np.zeros((sim_total, mm, max_cols))
    all_paid_triangles = np.zeros((sim_total, mm, max_cols))
    results = np.zeros((sim_total, 3))

    # Poprawne batchowanie również wtedy, gdy sim_total % batch_sim != 0.
    n_batches = (sim_total + batch_sim - 1) // batch_sim

    total_f_len_cl = n_dev + il_ogon

    for batch_idx in range(n_batches):
        start = batch_idx * batch_sim
        end = min(start + batch_sim, sim_total)
        cur_bs = end - start

        np.random.seed(main_seed + batch_idx)

        # Korelacyjne szoki P/I - jak w obecnym INCURRED.
        normal_shocks = np.random.normal(
            loc=0.0,
            scale=1.0,
            size=(cur_bs, mm, n_dev)
        )

        # -----------------------------------------------------
        # PARAMETER RISK - CL (obecna metoda INCURRED)
        # -----------------------------------------------------
        mu_part_inc = np.empty((cur_bs, n_dev))
        sigma_part_inc = np.empty((cur_bs, n_dev))

        for jj in range(n_dev):
            mu_part_inc[:, jj] = np.random.normal(
                loc=dev_inc[jj],
                scale=sd_inc[jj],
                size=cur_bs
            )
            df_cl = max(1, mm - jj - 2)
            chi_list_cl = np.random.chisquare(df_cl, size=cur_bs)
            for ss in range(cur_bs):
                sigma_part_inc[ss, jj] = (
                    chi_list_cl[ss] * sigma_inc[jj]
                ) / df_cl

        # -----------------------------------------------------
        # PARAMETER RISK - ADD/LR
        # Tablice LR istnieją ZAWSZE, nawet gdy k_zmiana == 0.
        # Wtedy mają shape (cur_bs, 0), ale Numba zna ich typ float64.
        # -----------------------------------------------------
        mu_part_lr = np.empty(
            (cur_bs, k_zmiana),
            dtype=np.float64
        )
        sigma_part_lr = np.empty(
            (cur_bs, k_zmiana),
            dtype=np.float64
        )

        if k_zmiana > 0:
            for jj in range(k_zmiana):
                mu_part_lr[:, jj] = np.random.normal(
                    loc=dev_inc_LR[jj],
                    scale=sd_inc_LR[jj],
                    size=cur_bs
                )
                df_lr = max(1, mm - jj)
                chi_list_lr = np.random.chisquare(df_lr, size=cur_bs)
                for ss in range(cur_bs):
                    sigma_part_lr[ss, jj] = (
                        chi_list_lr[ss] * sigma_inc_LR[jj]
                    ) / df_lr

        for s in range(cur_bs):
            sim_idx = start + s

            # -------------------------------------------------
            # Wagi CL
            # -------------------------------------------------
            empty_row = np.full((1, weights_np.shape[1]), np.nan)
            wagi_modified_row = np.vstack((weights_np, empty_row))
            empty_column_cl = np.full((wagi_modified_row.shape[0], 1), np.nan)
            wagi_modified = np.hstack((wagi_modified_row, empty_column_cl))

            # -------------------------------------------------
            # Wagi ADD/LR
            # Tworzymy je ZAWSZE, aby Numba znała typ zmiennej.
            # Przy pustym LR i k_zmiana == 0 będzie to pusta macierz
            # z jedną techniczną kolumną, która nie zostanie użyta.
            # -------------------------------------------------
            empty_column_lr = np.full(
                (wagi_trimmed_LR.shape[0], 1),
                np.nan,
                dtype=np.float64
            )
            wagi_modified_lr = np.hstack(
                (wagi_trimmed_LR, empty_column_lr)
            )

            # -------------------------------------------------
            # Wagi P/I
            # -------------------------------------------------
            empty_column_pi = np.full((data_wagi_pi.shape[0], 1), np.nan)
            data_wagi_pi_modifited = np.hstack((data_wagi_pi, empty_column_pi))

            m_i_inc = mu_part_inc[s, :]
            sigma_i_inc = sigma_part_inc[s, :]

            # Zawsze przypisujemy zmienne LR.
            # Dla k_zmiana == 0 są to puste tablice float64 o shape (0,).
            m_i_lr = mu_part_lr[s, :]
            sigma_i_lr = sigma_part_lr[s, :]

            # -------------------------------------------------
            # Kopie trójkątów do pełnej symulacji
            # -------------------------------------------------
            data_paid_copy = data_paid_np.copy()
            data_incurred_to_paid_copy = data_paid_np.copy()
            data_incurred_copy = data_inc_np.copy()

            # Zapewniamy co najmniej n_dev + 1 kolumn do pełnej projekcji.
            n_cols_current = data_paid_copy.shape[1]
            if n_cols_current < n_dev + 1:
                extra_cols = (n_dev + 1) - n_cols_current
                data_paid_copy = np.concatenate(
                    (data_paid_copy, np.zeros((mm, extra_cols))), axis=1
                )
                data_incurred_copy = np.concatenate(
                    (data_incurred_copy, np.zeros((mm, extra_cols))), axis=1
                )
                data_incurred_to_paid_copy = np.concatenate(
                    (data_incurred_to_paid_copy, np.zeros((mm, extra_cols))), axis=1
                )

            # Trójkąty jednoroczne - zawsze dokładamy jedną kolumnę.
            data_paid_to_one = np.concatenate(
                (data_paid_np.copy(), np.zeros((mm, 1))), axis=1
            )
            data_incurred_to_one = np.concatenate(
                (data_inc_np.copy(), np.zeros((mm, 1))), axis=1
            )

            # =================================================
            # 1. SYMULACJA INCURRED + P/I
            # =================================================
            for j in range(n_dev):
                max_ind_row = max(0, mm - j - 1)

                for r in range(max_ind_row, mm):
                    base_val = data_incurred_to_paid_copy[r, j]   # PAID(t)
                    base_val_inc = data_incurred_copy[r, j]      # INCURRED(t)

                    # Obecny model P/I wymaga dodatniego incurred w mianowniku.
                    if base_val_inc == 0:
                        continue

                    active_weight = 0.0

                    # -----------------------------------------
                    # ADD / LR
                    # -----------------------------------------
                    if j < k_zmiana:
                        var_ij_lr = sigma_i_lr[j] / e_values[r]

                        if m_i_lr[j] > 0.0:
                            lmean_lr = np.log(
                                m_i_lr[j] ** 2 /
                                np.sqrt(m_i_lr[j] ** 2 + var_ij_lr)
                            )
                            lstdev_lr = np.sqrt(
                                np.log(
                                    1.0 + var_ij_lr / (m_i_lr[j] ** 2)
                                )
                            )
                            sto_lr = np.random.lognormal(lmean_lr, lstdev_lr)

                            next_inc = (
                                base_val_inc + e_values[r] * sto_lr
                            )
                        else:
                            adj_mu_lr = (
                                m_i_lr[j] + base_val_inc / e_values[r]
                            )
                            lmean_lr = np.log(
                                adj_mu_lr ** 2 /
                                np.sqrt(adj_mu_lr ** 2 + var_ij_lr)
                            )
                            lstdev_lr = np.sqrt(
                                np.log(
                                    1.0 + var_ij_lr / (adj_mu_lr ** 2)
                                )
                            )
                            sto_lr = np.random.lognormal(lmean_lr, lstdev_lr)

                            next_inc = (
                                e_values[r] *
                                (sto_lr - base_val_inc / e_values[r]) +
                                base_val_inc
                            )

                        # Waga LR dla nowej przekątnej - 1:1 z logiką PAID ADD.
                        if r == mm - j - 1 and j < mm:
                            dev_con_lr = dev_inc_LR[j]
                            std_con_lr = sd_inc_LR[j]

                            if (
                                dev_con_lr - 2.0 * std_con_lr
                                <= sto_lr <=
                                dev_con_lr + 2.0 * std_con_lr
                            ):
                                active_weight = 1.0
                            elif (
                                (dev_con_lr - 3.0 * std_con_lr
                                 <= sto_lr <=
                                 dev_con_lr - 2.0 * std_con_lr)
                                or
                                (dev_con_lr + 2.0 * std_con_lr
                                 <= sto_lr <=
                                 dev_con_lr + 3.0 * std_con_lr)
                            ):
                                active_weight = 0.5
                            else:
                                active_weight = 0.0

                            wagi_modified_lr[r, j + 1] = active_weight

                    # -----------------------------------------
                    # CL
                    # -----------------------------------------
                    else:
                        var_ij_inc = sigma_i_inc[j] / base_val_inc
                        m_sq_inc = m_i_inc[j] * m_i_inc[j]

                        denom_inc = np.sqrt(m_sq_inc + var_ij_inc)
                        lmean_inc = np.log(m_sq_inc / denom_inc)
                        lstdev_inc = np.sqrt(
                            np.log(1.0 + (var_ij_inc / m_sq_inc))
                        )
                        cl_ij_inc = np.random.lognormal(
                            lmean_inc, lstdev_inc
                        )

                        next_inc = base_val_inc * cl_ij_inc

                        # Zachowujemy obecną logikę wag CL z INCURRED.
                        if r == mm - j - 1 and j < mm:
                            dev_con = dev_inc[j]
                            std_con = sd_inc[j]

                            if (
                                dev_con - 2.0 * std_con
                                <= cl_ij_inc <=
                                dev_con + 2.0 * std_con
                            ):
                                active_weight = 1.0
                            elif (
                                (dev_con - 3.0 * std_con
                                 <= cl_ij_inc <
                                 dev_con - 2.0 * std_con)
                                or
                                (dev_con + 2.0 * std_con
                                 < cl_ij_inc <=
                                 dev_con + 3.0 * std_con)
                            ):
                                active_weight = 0.5
                            else:
                                active_weight = 0.0

                            wagi_modified[r, j] = active_weight

                    # -----------------------------------------
                    # P/I - wspólne dla ADD i CL
                    # -----------------------------------------
                    if varj[j] == 0:
                        res_before = 0.0
                    else:
                        res_before = (
                            ((base_val / base_val_inc) - rj[j]) /
                            np.sqrt(varj[j] / base_val_inc)
                        )

                    r_i_j_sim = (
                        rj[j + 1]
                        +
                        np.sqrt(varj[j + 1] / next_inc)
                        *
                        (
                            normal_shocks[s, r, j]
                            + res_before * lambda_cor[0]
                        )
                    )

                    val_paid = next_inc * r_i_j_sim

                    data_incurred_copy[r, j + 1] = next_inc
                    data_incurred_to_paid_copy[r, j + 1] = val_paid

                    if r == mm - j - 1:
                        data_paid_to_one[r, j + 1] = val_paid
                        data_incurred_to_one[r, j + 1] = next_inc
                        data_paid_copy[r, j + 1] = val_paid
                        data_wagi_pi_modifited[r, j + 1] = active_weight

            # =================================================
            # 2. JEDNOROCZNA REESTYMACJA
            # =================================================
            data_incurred_to_one[1:, n_cols_orig] = np.nan
            data_paid_to_one[1:, n_cols_orig] = np.nan

            # -------------------------------------------------
            # CL - pozostawione zgodnie z obecnym INCURRED
            # -------------------------------------------------
            dev_j = Dev_prem(data_incurred_to_one, wagi_modified)
            l_ij = elementwise_division(data_incurred_to_one)
            sigma_all = calculate_sigma(
                data_incurred_to_one,
                l_ij,
                wagi_modified,
                dev_j
            )
            # calculate_sigma zwraca tutaj listę; konwersja do ndarray
            # pozwala indeksować przez tablicę ind_choode w Numbie.
            sd_sim = np.array(sigma_all[1])

            dev_sel, ind_choode = choose_value_list(
                dev_j, wykluczenia, 1, 10
            )
            sd_sel = sd_sim[ind_choode]

            sd_sel_ind = np.array(
                [ii for ii, x in enumerate(sd_sel) if x > 0],
                dtype=np.int64
            )
            sd_sel = sd_sel[sd_sel_ind]
            dev_sel = dev_sel[sd_sel_ind]

            # Jedyna techniczna korekta: x_k musi być filtrowane tak samo.
            x_k = (ind_choode + 1)[sd_sel_ind]

            a_coef, b_coef = fit_curve_factor_cl(
                dev_sel, sd_sel, x_k
            )

            total_f_len_cl = len(dev_j) + il_ogon

            if Poz_CL - 1 > 0:
                vec_f = np.empty(total_f_len_cl - 2)
                vec_f[:(Poz_CL - 1)] = dev_j[1:Poz_CL]
                vec_f[(Poz_CL - 1):] = 1.0
            else:
                vec_f = wspolczynnik_reg_factor_cl(
                    a_coef,
                    b_coef,
                    2,
                    total_f_len_cl - 1
                )

            # -------------------------------------------------
            # ADD / LR - przeniesione z hybrydowego PAID
            # -------------------------------------------------
            if k_zmiana > 0:
                LR_i_j_stoch = transform_data(
                    data_incurred_to_one,
                    e_values
                )
                LR_j_wyzn = wspolczynnik_LR(
                    LR_i_j_stoch,
                    wagi_modified_lr,
                    e_values
                )
                sigma_j_pred = sigma_LR(
                    LR_i_j_stoch,
                    wagi_modified_lr,
                    e_values,
                    LR_j_wyzn
                )
                sd_j = wspolczynnik_sd(
                    sigma_j_pred,
                    wagi_modified_lr,
                    e_values
                )

                vector_value, x_k_ind = choose_value_list(
                    LR_j_wyzn,
                    ilosc_dop_wsp_LR,
                    0,
                    10
                )
                sd_input = sd_j[x_k_ind]

                a_lr, b_lr = fit_curve_factor_lr(
                    vector_value,
                    sd_input,
                    x_k_ind
                )

                total_f_len_lr = (
                    len(LR_j_wyzn) + il_ogon_LR + 1
                )
                vec_lr = np.empty(total_f_len_lr - 2)

                if Poz_LR - 2 > 0:
                    vec_lr[:(Poz_LR - 2)] = LR_j_wyzn[2:Poz_LR]

                tail_factors_lr = wspolczynnik_reg_factor_lr(
                    float(a_lr),
                    float(b_lr),
                    Poz_LR,
                    total_f_len_lr - 1
                )

                lr_start = max(0, Poz_LR - 2)
                lr_remaining = len(vec_lr) - lr_start
                if lr_remaining > 0:
                    vec_lr[lr_start:] = tail_factors_lr[:lr_remaining]
            else:
                vec_lr = np.empty(0, dtype=np.float64)

            # =================================================
            # 3. FINALNA PROJEKCJA INCURRED: ADD + CL
            # =================================================
            data_paid_to_one_new = data_paid_to_one[:, 1:]
            data_incurred_to_one_new = data_incurred_to_one[:, 1:(n_cols_orig + 1)]

            tri_sim = data_incurred_to_one_new

            target_cols = len(vec_f) + 1
            pad_width = target_cols - tri_sim.shape[1]

            if pad_width > 0:
                tri_proj_tmp = np.hstack(
                    (tri_sim, np.full((mm, pad_width), np.nan))
                )
            else:
                tri_proj_tmp = tri_sim.copy()

            if k_zmiana > len(vec_lr):
                raise ValueError(
                    "k_zmiana jest większe niż liczba dostępnych współczynników LR"
                )

            for j in range(len(vec_f)):
                max_ind_row = max(0, mm - j - 1)

                for rr in range(max_ind_row, mm):
                    if j < k_zmiana:
                        tri_proj_tmp[rr, j + 1] = (
                            tri_proj_tmp[rr, j]
                            + e_values[rr] * vec_lr[j]
                        )
                    else:
                        tri_proj_tmp[rr, j + 1] = (
                            tri_proj_tmp[rr, j] * vec_f[j]
                        )

            actual_cols = tri_proj_tmp.shape[1]
            all_incurred_triangles[
                sim_idx, :, :actual_cols
            ] = tri_proj_tmp

            # =================================================
            # 4. JEDNOROCZNE P/I - bez zmiany metodologii
            # =================================================
            mm_local, nn = data_paid_to_one_new.shape

            for jjj in range(nn):
                licznik = 0.0
                mianownik = 0.0

                for iii in range(mm_local):
                    if (
                        data_wagi_pi_modifited[iii, jjj] != 0
                        and not np.isnan(data_wagi_pi_modifited[iii, jjj])
                    ):
                        licznik += (
                            data_wagi_pi_modifited[iii, jjj]
                            * data_paid_to_one[iii, jjj]
                        )
                        mianownik += (
                            data_wagi_pi_modifited[iii, jjj]
                            * data_incurred_to_one[iii, jjj]
                        )

                if mianownik == 0:
                    r_j_sim[sim_idx, jjj] = 1.0
                else:
                    r_j_sim[sim_idx, jjj] = licznik / mianownik

            # Ultimate z pełnej symulacji paid - jak dotychczas.
            u_i = data_incurred_to_paid_copy[:, -1]
            results[sim_idx, 0] = np.sum(u_i)

            actual_paid_cols = data_paid_copy.shape[1]
            all_paid_triangles[
                sim_idx, :, :actual_paid_cols
            ] = data_paid_copy

    # =========================================================
    # 5. ŚREDNI P/I I WEKTOR P/I
    # =========================================================
    for ii in range(n_cols_orig):
        suma = 0.0
        for jj in range(sim_total):
            suma += r_j_sim[jj, ii]
        r_j_sim_mean[ii] = suma / sim_total

    rj_choose, ind_choose = choose_value_list(
        r_j_sim_mean,
        wykluczenia_p_i,
        0,
        1
    )

    a_num, b_num = fit_curve_factor_P_to_I(
        rj_choose,
        ind_choose + 1
    )

    if Poz_CL_p_i - 1 > 0:
        vec_p_i = np.empty(total_f_len_cl - 1)
        vec_p_i[:(Poz_CL_p_i)] = r_j_sim_mean[:Poz_CL_p_i]
        vec_p_i[(Poz_CL_p_i):] = wspolczynnik_reg_factor_P_to_I(
            float(a_num),
            float(b_num),
            Poz_CL_p_i+1,
            total_f_len_cl-1
        )

        # Zachowanie 1:1 z obecnym kodem.
        if dop_ogo_p_i is True:
            vec_p_i[(Poz_CL_p_i):] = 1.0
        else:
            vec_p_i[(Poz_CL_p_i):] = 1.0
    else:
        vec_p_i = wspolczynnik_reg_factor_P_to_I(
            float(a_num),
            float(b_num),
            2,
            total_f_len_cl
        )

    # =========================================================
    # 6. INCURRED -> PAID + DYSKONTOWANIE
    # =========================================================
    for trian_sim_num in range(all_incurred_triangles.shape[0]):
        trian_sim = all_incurred_triangles[trian_sim_num, :, :]
        trian_sim_paid_one = all_paid_triangles[trian_sim_num, :, 1:]

        max_j_col = min(
            trian_sim_paid_one.shape[1],
            vec_p_i.shape[0],
            trian_sim.shape[1]
        )

        for j_col in range(1, max_j_col):
            max_ind_row = max(
                0,
                trian_sim_paid_one.shape[0] - j_col
            )

            for ii in range(max_ind_row, trian_sim.shape[0]):
                if (
                    j_col < vec_p_i.shape[0]
                    and j_col < trian_sim.shape[1]
                ):
                    trian_sim_paid_one[ii, j_col] = (
                        trian_sim[ii, j_col] * vec_p_i[j_col+1]
                    )

        # Pozostawione zgodnie z obecnym INCURRED.
        cols_tmp = max_j_col - 1
        tri_proj = np.empty((mm, cols_tmp + 1))
        tri_proj[:, 0] = data_paid_np[:, 0]

        for rr in range(mm):
            for cc in range(
                min(cols_tmp, trian_sim_paid_one.shape[1])
            ):
                tri_proj[rr, cc + 1] = trian_sim_paid_one[rr, cc]

        inc_proj = tri_proj[:, 1:] - tri_proj[:, :-1]

        inc_disc = np.empty_like(tri_proj)
        inc_disc[:, 0] = tri_proj[:, 0]

        for rr in range(mm):
            for cc in range(1, tri_proj.shape[1]):
                inc_disc[rr, cc] = inc_proj[rr, cc - 1]

        for rr in range(mm - 1, -1, -1):
            offset = mm - 1 - rr
            for cc in range(offset + 1, tri_proj.shape[1]):
                idx = cc - (offset + 1)
                if idx < len(discount_factors_safe):
                    inc_disc[rr, cc] /= discount_factors_safe[idx]

        cum_disc = inc_disc.copy()

        for rr in range(mm):
            for cc in range(1, tri_proj.shape[1]):
                cum_disc[rr, cc] += cum_disc[rr, cc - 1]

        cum_disc_ost = cum_disc[:, -1]
        ult_gross_disc = np.sum(cum_disc_ost)

        ult_net_disc = 0.0
        for i_net in range(len(latest)):
            ult_net_disc += (
                latest[i_net] + (cum_disc_ost[i_net] - latest[i_net]) * net_to_gross_safe[i_net]
            )


        results[trian_sim_num, 1] = ult_gross_disc
        results[trian_sim_num, 2] = ult_net_disc

    return results

@njit
def run_simulation_cl_numba_incurred(
        dev_inc,
        sigma_inc,
        sd_inc,
        rj,
        varj,
        r_i_j,
        lambda_cor,
        data_paid_np,
        data_inc_np,
        weights_np,
        wykluczenia,
        Poz_CL,
        data_wagi_pi,
        wykluczenia_p_i,
        Poz_CL_p_i,
        dop_ogo_p_i,
        il_ogon,
        discount_factors,
        net_to_gross,
        sim_total=1,
        batch_sim=1,
        main_seed=42):

    latest = vector_reverse_diagonal(data_paid_np)

    mm, n_cols_orig = data_paid_np.shape

    r_j_sim_mean = np.zeros(n_cols_orig)

    # r_j_sim_mean[0] = 0.814554021011695

    n_dev = len(dev_inc)

    r_j_sim = np.zeros(
        (sim_total, n_cols_orig)
    )

    all_incurred_triangles = np.zeros(
        (sim_total, mm, n_dev + 1)
    )

    all_paid_triangles = np.zeros(
        (sim_total, mm, n_dev + 1)
    )

    results = np.zeros(
        (sim_total, 3)
    )

    num_batches = sim_total // batch_sim

    np_liczby = np.random.randint(
        -10000,
        10000,
        size=num_batches
    )

    results = np.zeros(
        (sim_total, 3)
    )

    for batch in range(num_batches):

        # seed = main_seed + 0

        seed = main_seed + np_liczby[batch]

        np.random.seed(seed)

        normal_shocks = np.random.normal(
            loc=0.0,
            scale=1.0,
            size=(batch_sim, mm, n_dev)
        )

        mu_part_inc = np.empty(
            (batch_sim, n_dev)
        )

        sigma_part_inc = np.empty(
            (batch_sim, n_dev)
        )

        for jj in range(n_dev):

            mu_part_inc[:, jj] = np.random.normal(
                loc=dev_inc[jj],
                scale=sd_inc[jj],
                size=batch_sim
            )

            df = max(
                1,
                mm - jj - 2
            )

            chi_list = np.random.chisquare(
                df,
                size=batch_sim
            )

            for s in range(batch_sim):

                sigma_part_inc[s, jj] = (
                    chi_list[s]
                    * sigma_inc[jj]
                ) / df

        for i in range(batch_sim):

            empty_row = np.full(
                (1, weights_np.shape[1]),
                np.nan
            )

            wagi_modified_row = np.vstack(
                (
                    weights_np,
                    empty_row
                )
            )

            empty_column = np.full(
                (
                    wagi_modified_row.shape[0],
                    1
                ),
                np.nan
            )

            wagi_modified = np.hstack(
                (
                    wagi_modified_row,
                    empty_column
                )
            )

            empty_column = np.full(
                (
                    data_wagi_pi.shape[0],
                    1
                ),
                np.nan
            )

            data_wagi_pi_modified = np.hstack(
                (
                    data_wagi_pi,
                    empty_column
                )
            )

            m_i_inc = mu_part_inc[i, :]

            sigma_i_inc = sigma_part_inc[i, :]

            data_paid_copy = data_paid_np.copy()

            data_incurred_to_paid_copy = (
                data_paid_np.copy()
            )

            data_incurred_copy = (
                data_inc_np.copy()
            )

            data_paid_to_one = (
                data_paid_np.copy()
            )

            data_incurred_to_one = (
                data_inc_np.copy()
            )

            n_cols_current = (
                data_paid_copy.shape[1]
            )

            if n_cols_current < n_dev + 1:

                extra_cols = (
                    n_dev + 1
                ) - n_cols_current

                data_paid_copy = np.concatenate(
                    (
                        data_paid_copy,
                        np.zeros(
                            (
                                mm,
                                extra_cols
                            )
                        )
                    ),
                    axis=1
                )

                data_incurred_copy = np.concatenate(
                    (
                        data_incurred_copy,
                        np.zeros(
                            (
                                mm,
                                extra_cols
                            )
                        )
                    ),
                    axis=1
                )

                data_incurred_copy_cl = np.concatenate(
                    (
                        data_incurred_copy,
                        np.zeros(
                            (
                                mm,
                                extra_cols
                            )
                        )
                    ),
                    axis=1
                )

                data_incurred_to_paid_copy = np.concatenate(
                    (
                        data_incurred_to_paid_copy,
                        np.zeros(
                            (
                                mm,
                                extra_cols
                            )
                        )
                    ),
                    axis=1
                )

                data_paid_to_one = (
                    data_paid_np.copy()
                )

                data_paid_to_one = np.concatenate(
                    (
                        data_paid_to_one,
                        np.zeros(
                            (
                                mm,
                                1
                            )
                        )
                    ),
                    axis=1
                )

                data_incurred_to_one = np.concatenate(
                    (
                        data_incurred_to_one,
                        np.zeros(
                            (
                                mm,
                                1
                            )
                        )
                    ),
                    axis=1
                )

            else:
                # zabezpieczenie przed niezainicjalizowaną zmienną
                data_incurred_copy_cl = (
                    data_incurred_copy.copy()
                )

            n_cols_current = (
                data_paid_copy.shape[1]
            )

            for j in range(n_dev):

                max_ind_row = max(
                    0,
                    mm - j - 1
                )

                for r in range(
                    max_ind_row,
                    mm
                ):

                    base_val = (
                        data_incurred_to_paid_copy[
                            r,
                            j
                        ]
                    )

                    base_val_inc = (
                        data_incurred_copy[
                            r,
                            j
                        ]
                    )

                    if base_val_inc == 0:
                        continue

                    var_ij_inc = (
                        sigma_i_inc[j]
                        / base_val_inc
                    )

                    m_sq_inc = (
                        m_i_inc[j]
                        * m_i_inc[j]
                    )

                    denom_inc = np.sqrt(
                        m_sq_inc
                        + var_ij_inc
                    )

                    dev_con = m_i_inc[j]

                    std_con = np.sqrt(
                        var_ij_inc
                    )

                    # dev_con = dev_inc[j]
                    # std_con = sd_inc[j]

                    lmean_inc = np.log(
                        m_sq_inc
                        / denom_inc
                    )

                    lstdev_inc = np.sqrt(
                        np.log(
                            1
                            +
                            (
                                var_ij_inc
                                / m_sq_inc
                            )
                        )
                    )

                    cl_ij_inc = (
                        np.random.lognormal(
                            lmean_inc,
                            lstdev_inc
                        )
                    )

                    if varj[j] == 0:

                        r_i_j_sim_ind = 1

                    else:

                        res_before = (
                            (
                                (
                                    base_val
                                    / base_val_inc
                                )
                                - rj[j]
                            )
                            /
                            np.sqrt(
                                varj[j]
                                / base_val_inc
                            )
                        )

                        r_i_j_sim_ind = (
                            rj[j + 1]
                            +
                            (
                                np.sqrt(
                                    varj[j + 1]
                                    /
                                    (
                                        base_val_inc
                                        * cl_ij_inc
                                    )
                                )
                            )
                            *
                            (
                                normal_shocks[
                                    i,
                                    r,
                                    j
                                ]
                                +
                                res_before
                                * lambda_cor[0]
                            )
                        )

                    data_incurred_copy[
                        r,
                        j + 1
                    ] = (
                        base_val_inc
                        * cl_ij_inc
                    )

                    data_incurred_copy_cl[
                        r,
                        j + 1
                    ] = cl_ij_inc

                    r_i_j_sim = min(
                        r_i_j_sim_ind,
                        1.0
                    )

                    # r_i_j_sim = 1

                    val_paid = (
                        base_val_inc
                        * cl_ij_inc
                        * r_i_j_sim
                    )

                    data_incurred_to_paid_copy[
                        r,
                        j + 1
                    ] = val_paid

                    if r == mm - j - 1:

                        # val_paid = base_val_inc * cl_ij_inc * 1

                        data_paid_to_one[
                            r,
                            j + 1
                        ] = val_paid

                        data_incurred_to_one[
                            r,
                            j + 1
                        ] = (
                            base_val_inc
                            * cl_ij_inc
                        )

                        data_paid_copy[
                            r,
                            j + 1
                        ] = val_paid

                    if (
                        r == mm - j - 1
                        and j < mm
                    ):

                        if (
                            dev_con
                            - 2 * std_con
                            <= cl_ij_inc
                            <= dev_con
                            + 2 * std_con
                        ):

                            wagi_modified[
                                r,
                                j
                            ] = 1

                            data_wagi_pi_modified[
                                r,
                                j + 1
                            ] = 1

                        elif (
                            (
                                dev_con
                                - 3 * std_con
                                <= cl_ij_inc
                                < dev_con
                                - 2 * std_con
                            )
                            or
                            (
                                dev_con
                                + 2 * std_con
                                < cl_ij_inc
                                <= dev_con
                                + 3 * std_con
                            )
                        ):

                            wagi_modified[
                                r,
                                j
                            ] = 0.5

                            data_wagi_pi_modified[
                                r,
                                j + 1
                            ] = 0.5

                        else:

                            wagi_modified[
                                r,
                                j
                            ] = 0

                            data_wagi_pi_modified[
                                r,
                                j + 1
                            ] = 0

            data_incurred_to_one[
                1:,
                n_cols_orig
            ] = np.nan

            data_paid_to_one[
                1:,
                n_cols_orig
            ] = np.nan

            dev_j = Dev_prem(
                data_incurred_to_one,
                wagi_modified
            )

            l_ij = elementwise_division(
                data_incurred_to_one
            )

            sigma_all = calculate_sigma(
                data_incurred_to_one,
                l_ij,
                wagi_modified,
                dev_j
            )

            sd_sim = sigma_all[1]

            dev_sel, ind_choode = (
                choose_value_list(
                    dev_j,
                    wykluczenia,
                    1,
                    10
                )
            )

            # -----------------------------------
            # POPRAWKA DLA NUMBA
            # oryginalnie:
            # sd_sel = sd_sim[ind_choode]
            # -----------------------------------

            sd_sel = np.empty(
                len(ind_choode),
                dtype=np.float64
            )

            for kk in range(
                len(ind_choode)
            ):

                sd_sel[kk] = (
                    sd_sim[
                        ind_choode[kk]
                    ]
                )

            # wybieramy tylko sd > 0
            liczba_dodatnich = 0

            for kk in range(
                len(sd_sel)
            ):

                if sd_sel[kk] > 0:
                    liczba_dodatnich += 1

            sd_sel_new = np.empty(
                liczba_dodatnich,
                dtype=np.float64
            )

            dev_sel_new = np.empty(
                liczba_dodatnich,
                dtype=np.float64
            )

            pos = 0

            for kk in range(
                len(sd_sel)
            ):

                if sd_sel[kk] > 0:

                    sd_sel_new[pos] = (
                        sd_sel[kk]
                    )

                    dev_sel_new[pos] = (
                        dev_sel[kk]
                    )

                    pos += 1

            sd_sel = sd_sel_new
            dev_sel = dev_sel_new

            x_k = ind_choode + 1

            a_coef, b_coef = (
                fit_curve_factor_cl(
                    dev_sel,
                    sd_sel,
                    x_k
                )
            )

            total_f_len = (
                len(dev_j)
                + il_ogon
            )

            if Poz_CL - 1 > 0:

                vec_f = np.empty(
                    total_f_len - 1
                )

                vec_f[
                    :(Poz_CL - 1)
                ] = (
                    dev_j[
                        1:Poz_CL
                    ]
                )

                vec_f[
                    (Poz_CL - 1):
                ] = (
                    wspolczynnik_reg_factor_cl(
                        a_coef,
                        b_coef,
                        Poz_CL + 1,
                        total_f_len
                    )
                )

            else:

                vec_f = (
                    wspolczynnik_reg_factor_cl(
                        a_coef,
                        b_coef,
                        2,
                        total_f_len - 1
                    )
                )

            data_paid_to_one_new = (
                data_paid_to_one[
                    :,
                    1:
                ]
            )

            data_incurred_to_one_new = (
                data_incurred_to_one[
                    :,
                    1:(n_cols_orig + 1)
                ]
            )

            # vec_f[8:] = 1

            tri_proj_tmp = (
                triangle_forward_one_np(
                    data_incurred_to_one_new,
                    vec_f,
                    1
                )
            )

            ###############################################################

            mm, nn = (
                data_paid_to_one_new.shape
            )

            for jjj in range(
                0,
                nn
            ):

                licznik = 0.0
                mianownik = 0.0

                max_ind_row_rj = max(
                    0,
                    mm - jjj
                )

                for iii in range(
                    0,
                    mm
                ):

                    if (
                        data_wagi_pi_modified[
                            iii,
                            jjj
                        ] != 0
                        and
                        not np.isnan(
                            data_wagi_pi_modified[
                                iii,
                                jjj
                            ]
                        )
                    ):

                        licznik = (
                            licznik
                            +
                            data_wagi_pi_modified[
                                iii,
                                jjj
                            ]
                            *
                            data_paid_to_one[
                                iii,
                                jjj
                            ]
                        )

                        mianownik = (
                            mianownik
                            +
                            data_wagi_pi_modified[
                                iii,
                                jjj
                            ]
                            *
                            data_incurred_to_one[
                                iii,
                                jjj
                            ]
                        )

                if mianownik == 0:

                    r_j_sim[
                        batch * batch_sim + i,
                        jjj
                    ] = 1

                else:

                    r_j_sim[
                        batch * batch_sim + i,
                        jjj
                    ] = (
                        licznik
                        / mianownik
                    )

            #################### koniec jednoroczne

            u_i = (
                data_incurred_to_paid_copy[
                    :,
                    data_incurred_to_paid_copy.shape[1]
                    - 1
                ]
            )

            results[
                batch * batch_sim + i,
                0
            ] = np.sum(u_i)

            all_incurred_triangles[
                batch * batch_sim + i
            ] = tri_proj_tmp

            all_paid_triangles[
                batch * batch_sim + i
            ] = data_paid_copy

    for i in range(
        1,
        n_cols_orig
    ):

        suma = 0.0

        for j in range(
            sim_total
        ):

            suma += r_j_sim[
                j,
                i
            ]

        r_j_sim_mean[i] = (
            suma
            / sim_total
        )

    r_j_sim_mean[0] = rj[0]

    rj_choose, ind_choose = (
        choose_value_list(
            r_j_sim_mean,
            wykluczenia_p_i,
            0,
            1
        )
    )

    a_num, b_num = (
        fit_curve_factor_P_to_I(
            rj_choose,
            ind_choose + 1
        )
    )

    if Poz_CL_p_i - 1 > 0:

        vec_p_i = np.empty(
            total_f_len - 1
        )

        vec_p_i[
            :Poz_CL_p_i
        ] = (
            r_j_sim_mean[
                :Poz_CL_p_i
            ]
        )

        vec_p_i[
            Poz_CL_p_i:
        ] = (
            wspolczynnik_reg_factor_P_to_I(
                float(a_num),
                float(b_num),
                Poz_CL_p_i + 1,
                total_f_len - 1
            )
        )

    else:

        vec_p_i = (
            wspolczynnik_reg_factor_P_to_I(
                float(a_num),
                float(b_num),
                1,
                total_f_len - 1
            )
        )

    # vec_p_i[12:] = 1
    # print(vec_p_i)

    for trian_sim_num in range(
        all_incurred_triangles.shape[0]
    ):

        trian_sim = (
            all_incurred_triangles[
                trian_sim_num,
                :,
                :
            ]
        )

        trian_sim_paid_one = (
            all_paid_triangles[
                trian_sim_num,
                :,
                1:
            ]
        )

        for j_col in range(
            1,
            trian_sim_paid_one.shape[1]
        ):

            max_ind_row = max(
                0,
                trian_sim_paid_one.shape[0]
                - j_col
            )

            for i in range(
                max_ind_row,
                trian_sim.shape[0]
            ):

                trian_sim_paid_one[
                    i,
                    j_col
                ] = (
                    trian_sim[
                        i,
                        j_col
                    ]
                    *
                    vec_p_i[
                        j_col + 1
                    ]
                )

        cols_tmp = (
            trian_sim_paid_one.shape[1]
        )

        tri_proj = np.empty(
            (
                mm,
                cols_tmp + 1
            )
        )

        tri_proj[
            :,
            0
        ] = (
            data_incurred_to_paid_copy[
                :,
                0
            ]
        )

        for r in range(mm):

            for c in range(
                cols_tmp
            ):

                tri_proj[
                    r,
                    c + 1
                ] = (
                    trian_sim_paid_one[
                        r,
                        c
                    ]
                )

        inc_proj = (
            tri_proj[:, 1:]
            -
            tri_proj[:, :-1]
        )

        inc_disc = np.empty_like(
            tri_proj
        )

        inc_disc[:, 0] = (
            tri_proj[:, 0]
        )

        for r in range(mm):

            for c in range(
                1,
                tri_proj.shape[1]
            ):

                inc_disc[
                    r,
                    c
                ] = (
                    inc_proj[
                        r,
                        c - 1
                    ]
                )

        for rr in range(
            mm - 1,
            -1,
            -1
        ):

            offset = (
                mm - 1 - rr
            )

            for cc in range(
                offset + 1,
                tri_proj.shape[1]
            ):

                idx = (
                    cc
                    -
                    (
                        offset + 1
                    )
                )

                if idx < len(
                    discount_factors
                ):

                    inc_disc[
                        rr,
                        cc
                    ] /= (
                        discount_factors[
                            idx
                        ]
                    )

        cum_disc = (
            inc_disc.copy()
        )

        for r in range(mm):

            for c in range(
                1,
                tri_proj.shape[1]
            ):

                cum_disc[
                    r,
                    c
                ] += (
                    cum_disc[
                        r,
                        c - 1
                    ]
                )

        cum_disc_ost = (
            cum_disc[:, -1]
        )

        ult_gross_disc = np.sum(
            cum_disc[:, -1]
        )

        ult_net_disc = 0.0

        for iii in range(
            len(latest)
        ):

            ult_net_disc += (
                latest[iii]
                +
                (
                    cum_disc_ost[iii]
                    -
                    latest[iii]
                )
                *
                net_to_gross[iii]
            )

        results[
            trian_sim_num,
            1
        ] = ult_gross_disc

        results[
            trian_sim_num,
            2
        ] = ult_net_disc

    return results


class ClincSimulator:

    def run_simulation_clinc(self, dev_inc, sigma_inc, sd_inc,
                         rj, varj,r_i_j, lambda_cor, data_paid_np, data_inc_np,weights_np, wykluczenia,
                         Poz_CL,  data_wagi_pi,  wykluczenia_p_i,
                         Poz_CL_p_i,dop_ogo_p_i,
                         il_ogon,discount_factors,net_to_gross,
             sim_total=1, batch_sim=1, main_seed=202260011,
             sigma_inc_LR=None, dev_inc_LR=None, sd_inc_LR=None,
             e_values=None, wagi_trimmed_LR=None,
             ilosc_dop_wsp_LR=None, Poz_LR=0, il_ogon_LR=0,
             k_zmiana=0):

        # Backward compatible defaults: old CL callers can ignore LR args.
        if sigma_inc_LR is None:
            sigma_inc_LR = np.empty(0, dtype=np.float64)
        else:
            sigma_inc_LR = np.asarray(sigma_inc_LR, dtype=np.float64)

        if dev_inc_LR is None:
            dev_inc_LR = np.empty(0, dtype=np.float64)
        else:
            dev_inc_LR = np.asarray(dev_inc_LR, dtype=np.float64)

        if sd_inc_LR is None:
            sd_inc_LR = np.empty(0, dtype=np.float64)
        else:
            sd_inc_LR = np.asarray(sd_inc_LR, dtype=np.float64)

        if e_values is None:
            e_values = np.empty(0, dtype=np.float64)
        else:
            e_values = np.asarray(e_values, dtype=np.float64)

        if wagi_trimmed_LR is None:
            wagi_trimmed_LR = np.empty((0, 0), dtype=np.float64)
        else:
            wagi_trimmed_LR = np.asarray(wagi_trimmed_LR, dtype=np.float64)

        if ilosc_dop_wsp_LR is None:
            ilosc_dop_wsp_LR = np.empty(0, dtype=np.int32)
        else:
            ilosc_dop_wsp_LR = np.asarray(ilosc_dop_wsp_LR, dtype=np.int32)



        results_incurred = run_simulation_cl_numba_incurred(
            dev_inc,
            sigma_inc,
            sd_inc,
            rj,
            varj,
            r_i_j,
            lambda_cor,
            data_paid_np,
            data_inc_np,
            weights_np,
            wykluczenia,
            Poz_CL,
            data_wagi_pi,
            wykluczenia_p_i,
            Poz_CL_p_i,
            dop_ogo_p_i,
            il_ogon,
            discount_factors,
            net_to_gross,
            sim_total,
            batch_sim,
            main_seed
        )


       # return run_simulation_cl_numba_incurred( dev_inc, sigma_inc, sd_inc,
       #                  rj, varj,r_i_j, lambda_cor, data_paid_np, data_inc_np,weights_np, wykluczenia,
       #                  Poz_CL,  data_wagi_pi,  wykluczenia_p_i,
        #                 Poz_CL_p_i,dop_ogo_p_i,
       #                  il_ogon,discount_factors,net_to_gross,
        #     sigma_inc_LR, dev_inc_LR, sd_inc_LR,
        #     e_values, wagi_trimmed_LR, ilosc_dop_wsp_LR,
         #    Poz_LR, il_ogon_LR, k_zmiana,
         #                sim_total, batch_sim, main_seed)
        return results_incurred
