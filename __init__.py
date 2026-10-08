
from typing import Iterable, Sequence
import time

import numpy as np
import pandas as pd
from numba import njit, prange

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


@njit
def stochastic_triangle_forward_numba_batched(
    data_paid,
    sigma_j,
    dev,
    sd,
    wagi_trimmed,
    wykluczenia,
    Poz_CL,
    il_ogon,
    discount_factors,   
    net_to_gross,       
    latest,
    sim_total=100_000,
    batch_sim=1_000,
    main_seed=202260011,
):
 
    latest = vector_reverse_diagonal(data_paid)
    mm, n_cols_orig = data_paid.shape
    n_dev = len(dev)
    results = np.zeros((sim_total, 3))
    n_batches = sim_total // batch_sim
    n_cols_target = n_dev + 1
    disc_len = n_cols_target - 1
    discount_factors_safe = discount_factors
    if len(discount_factors) == 0:
        discount_factors_safe = np.ones(disc_len)
    else:
        discount_factors_safe = np.ones(disc_len)
        up_to = disc_len if len(discount_factors) > disc_len else len(discount_factors)
        for i in range(up_to):
            discount_factors_safe[i] = discount_factors[i]
    if len(net_to_gross) == 0:
        net_to_gross_safe = np.ones(mm)
    else:
        net_to_gross_safe = np.ones(mm)
        up_to = mm if len(net_to_gross) > mm else len(net_to_gross)
        for i in range(up_to):
            net_to_gross_safe[i] = net_to_gross[i]
    for batch_idx in range(n_batches):
        np.random.seed(main_seed + batch_idx)
        
        mu_part = np.empty((batch_sim, n_dev))
        sigma_part = np.empty((batch_sim, n_dev))

        for j in range(n_dev):
            
            mu_part[:, j] = np.random.normal(dev[j], sd[j], batch_sim)
            df = max(1, mm - j - 2)
            
            chi = np.random.chisquare(df, batch_sim)
            for s in range(batch_sim):
                sigma_part[s, j] = (chi[s]* sigma_j[j]) / df
        for i in range(batch_sim):
            m_i = mu_part[i]
            s_i = sigma_part[i]

            tri_copy = np.zeros((mm, n_cols_target))
            new_tri = np.zeros((mm, n_cols_target))
            for rr in range(mm):
                for c in range(n_cols_orig):
                    v = data_paid[rr, c]
                    tri_copy[rr, c] = v
                    new_tri[rr, c] = v

            empty_row = np.full((1, wagi_trimmed.shape[1]), np.nan)
            wagi_modified_row = np.vstack((wagi_trimmed, empty_row))
            empty_column = np.full((wagi_modified_row.shape[0], 1), np.nan)
            wagi_modified = np.hstack((wagi_modified_row, empty_column))

            for j in range(n_dev):
                max_row = max(1, mm - j)
                for r in range(max_row - 1, mm):
                    base = tri_copy[r, j]
                    if base > 0.0:
                        var_ij = s_i[j] / base
                        m2 = m_i[j] * m_i[j]
                        denom = np.sqrt(m2 + var_ij)
                        ln_mean = np.log(m2 / denom)
                        ln_sd = np.sqrt(np.log(1.0 + (var_ij / m2)))
                        cl_factor = np.random.lognormal(ln_mean, ln_sd)
                        tri_copy[r, j + 1] = base * cl_factor

                        dev_con = m_i[j]
                        std_con = np.sqrt(var_ij)
                        if r == mm - j - 1:
                            new_tri[r, j + 1] = base * cl_factor
                            if j < mm:
                                if (dev_con - 2.0 * std_con) <= cl_factor <= (dev_con + 2.0 * std_con):
                                    wagi_modified[r, j] = 1.0
                                elif ((dev_con - 3.0 * std_con) <= cl_factor < (dev_con - 2.0 * std_con)) or \
                                     ((dev_con + 2.0 * std_con) < cl_factor <= (dev_con + 3.0 * std_con)):
                                    wagi_modified[r, j] = 0.5
                                else:
                                    wagi_modified[r, j] = 0
                    else:
                        tri_copy[r, j + 1] = 0.0
                        if r == mm - j - 1:
                            new_tri[r, j + 1] = 0.0
                            wagi_modified[r, j] = 0.0
             # Ensure we don't access column beyond new_tri bounds
            if n_cols_orig < n_cols_target:
                new_tri[1:, n_cols_orig] = np.nan
            tri_sim = new_tri[:, 1:(n_cols_orig+1)]
            dev_j = Dev_prem(new_tri[:, :(n_cols_orig+1)], wagi_modified)
            l_ij = elementwise_division(new_tri[:, :(n_cols_orig+1)])
            sigma_all = calculate_sigma(new_tri[:, :(n_cols_orig+1)], l_ij, wagi_modified, dev_j)
            sd_sim = np.array(sigma_all[1]) # konwertuj listę na tablicę numpy
            dev_sel, ind_choode = choose_value_list(dev_j, wykluczenia, 1, 10)
            sd_sel = sd_sim[ind_choode]
            x_k = ind_choode + 1
            a_coef, b_coef = fit_curve_factor_cl(dev_sel, sd_sel, x_k)

            total_f_len = len(dev_j) + il_ogon
            if (Poz_CL - 1) > 0:
                vec_f = np.empty(total_f_len - 1)
                # zachowanie jak w oryginale
                for k in range(Poz_CL - 1):
                    vec_f[k] = dev_j[k + 1]
                tail_from = Poz_CL + 1
                tail_to = total_f_len
                tail = wspolczynnik_reg_factor_cl(a_coef, b_coef, tail_from, tail_to)
                tlen = len(tail)
                for k in range(tlen):
                    vec_f[(Poz_CL - 1) + k] = tail[k]
            else:
                tail = wspolczynnik_reg_factor_cl(a_coef, b_coef, 2, total_f_len)
                vec_f = tail

            tri_proj_tmp = triangle_forward_one_np(tri_sim, vec_f, 1)[:, :-1]
            cols_tmp = tri_proj_tmp.shape[1]
            tri_proj = np.empty((mm, cols_tmp + 1))
            tri_proj[:, 0] = data_paid[:, 0]
            for r in range(mm):
                for c in range(cols_tmp):
                    tri_proj[r, c + 1] = tri_proj_tmp[r, c]

            # inkrementy
            inc_proj = tri_proj[:, 1:] - tri_proj[:, :-1]

            # kopiowanie do macierzy dyskontowanej
            inc_disc = np.empty_like(tri_proj)
            inc_disc[:, 0] = tri_proj[:, 0]
            for r in range(mm):
                for c in range(1, tri_proj.shape[1]):
                    inc_disc[r, c] = inc_proj[r, c - 1]

            # dyskontowanie: używamy discount_factors_safe (fallback = 1.0)
            for rr in range(mm - 1, -1, -1):
                offset = mm - 1 - rr
                for cc in range(offset + 1, inc_disc.shape[1]):
                    idx = cc - (offset + 1)
                    if idx < len(discount_factors_safe) and not np.isnan(inc_disc[rr, cc]):
                        inc_disc[rr, cc] /= discount_factors_safe[idx]

            # kumulacja po kolumnach
            cum_disc = inc_disc.copy()
            for r in range(mm):
                for c in range(1, tri_proj.shape[1]):
                    cum_disc[r, c] = cum_disc[r, c] + cum_disc[r, c - 1]

            ult_gross_disc = np.sum(cum_disc[:, -1])
   
            # przekrój końcowej kolumny (PV brutto per wiersz)
            cum_trian_ost = cum_disc[:,  - 1]

            ult_net_disc = 0.0
            for iii in range(len(latest)):
                ult_net_disc += latest[iii] + (cum_trian_ost[iii] - latest[iii]) * net_to_gross_safe[iii]

            ult_gross = 0.0
            for r in range(mm):
                ult_gross += tri_copy[r, n_cols_target - 1]

            idx_out = int(batch_idx * batch_sim + i)
            results[idx_out, 0] = ult_gross
            results[idx_out, 1] = ult_gross_disc
            results[idx_out, 2] = ult_net_disc

    return results


class YearHorizont2:
   
    def vector_reverse_diagonal_to_script(self,data):
        return vector_reverse_diagonal(data)

    def run_simulation_cl(self,
    data_paid,
    sigma_j,
    dev,
    sd,
    wagi_trimmed,
    wykluczenia,
    Poz_CL,
    il_ogon,
    discount_factors,
    net_to_gross,
    latest,
    sim_total=100,
    batch_sim=100,
    main_seed=202260011):
        latest = self.vector_reverse_diagonal_to_script(data_paid)

        return stochastic_triangle_forward_numba_batched(
            data_paid,
            sigma_j,
            dev,
            sd,
            wagi_trimmed,
            wykluczenia,
            Poz_CL,
            il_ogon,
            discount_factors,
            net_to_gross,
            latest,
            sim_total,
            batch_sim,
            main_seed
        )



    def triangle_forward_np(self, data, f, k_forward_start, discount_factors, net_to_gross):
        data = data.copy()
        mm, nn = data.shape

        latest = self.vector_reverse_diagonal_to_script(data)
        base_col = data[:, 0].copy()

        if len(f) > mm:
            pad_width = len(f) + 1 - nn
            if pad_width > 0:
                data = np.hstack((data, np.full((mm, pad_width), np.nan)))

        for j in range(k_forward_start - 1, len(f)):
            max_ind_row = max(0, mm - j - 1)
            for i in range(max_ind_row, mm):
                data[i, j + 1] = data[i, j] * f[j]

        cols_tmp = data.shape[1]

        last_col = data[:, -1].copy()
        tri_proj = np.full((mm, cols_tmp + 1), np.nan)
        tri_proj[:, 0] = base_col
        tri_proj[:, 1:] = data

        inc_proj = tri_proj[:, 1:] - tri_proj[:, :-1]
        inc_proj[:, 0] = base_col


        if discount_factors is None or len(discount_factors) == 0:
            discount_factors = np.ones(cols_tmp, dtype=float)
        else:
            discount_factors = np.asarray(discount_factors, dtype=float)

        for rr in range(mm - 1, -1, -1):
            offset = mm - 1 - rr
            for cc in range(offset + 1, inc_proj.shape[1]):
                idx = cc - (offset + 1)
                if idx < len(discount_factors) and not np.isnan(inc_proj[rr, cc]):
                    inc_proj[rr, cc] /= discount_factors[idx]


        cum_trian = np.nansum(inc_proj, axis=1)
        if net_to_gross is None or len(net_to_gross) == 0:
            net_to_gross = np.ones_like(latest, dtype=float)
        else:
            net_to_gross = np.asarray(net_to_gross, dtype=float)
            if len(net_to_gross) < len(latest):
                net_to_gross = np.pad(net_to_gross, (0, len(latest) - len(net_to_gross)), constant_values=1.0)
            elif len(net_to_gross) > len(latest):
                net_to_gross = net_to_gross[:len(latest)]
        net_to_gross = net_to_gross[::-1]
        ult_net_disc_vec = [
            latest[i] + (cum_trian[i] - latest[i]) * net_to_gross[i]
            for i in range(len(latest))
        ]
        cum_trian_minus_latest = [
            cum_trian[i] - latest[i]
            for i in range(len(latest))
        ]
        ult_net_disc_minus_latest = [
            ult_net_disc_vec[i] - latest[i]
            for i in range(len(latest))
        ]
        last_col_minus_latest = [
            last_col[i] - latest[i]
            for i in range(len(latest))
        ]

        return {
            "last_col": last_col,
            "latest": latest,
            "cum_trian": cum_trian,
            "ult_net_disc": ult_net_disc_vec,
            "last_col_minus_latest": last_col_minus_latest,
            "cum_trian_minus_latest": cum_trian_minus_latest,
            "ult_net_disc_minus_latest": ult_net_disc_minus_latest,
        }

    def triangle_forward_change(self, data, f, lr,exposure, k_change, discount_factors, net_to_gross):
        data = data.copy()
        mm, nn = data.shape
        lr = lr[1:]
        print("k_change:", k_change)
        latest = self.vector_reverse_diagonal_to_script(data)
        base_col = data[:, 0].copy()
        ind_num = np.max([len(lr)-1, len(f)])
        if ind_num > mm:
            pad_width = ind_num + 1 - nn
            if pad_width > 0:
                data = np.hstack((data, np.full((mm, pad_width), np.nan)))
        for j in range(0, ind_num):
            max_ind_row = max(0, mm - j - 1)
            for i in range(max_ind_row, mm):
                if j < k_change:
                    data[i, j + 1] = data[i, j] + exposure[i] * lr[j]
                else:
                    data[i, j + 1] = data[i, j] * f[j]

        cols_tmp = data.shape[1]

        last_col = data[:, -1].copy()
        tri_proj = np.full((mm, cols_tmp + 1), np.nan)
        tri_proj[:, 0] = base_col
        tri_proj[:, 1:] = data

        inc_proj = tri_proj[:, 1:] - tri_proj[:, :-1]
        inc_proj[:, 0] = base_col


        if discount_factors is None or len(discount_factors) == 0:
            discount_factors = np.ones(cols_tmp, dtype=float)
        else:
            discount_factors = np.asarray(discount_factors, dtype=float)

        for rr in range(mm - 1, -1, -1):
            offset = mm - 1 - rr
            for cc in range(offset + 1, inc_proj.shape[1]):
                idx = cc - (offset + 1)
                if idx < len(discount_factors) and not np.isnan(inc_proj[rr, cc]):
                    inc_proj[rr, cc] /= discount_factors[idx]


        cum_trian = np.nansum(inc_proj, axis=1)
        if net_to_gross is None or len(net_to_gross) == 0:
            net_to_gross = np.ones_like(latest, dtype=float)
        else:
            net_to_gross = np.asarray(net_to_gross, dtype=float)
            if len(net_to_gross) < len(latest):
                net_to_gross = np.pad(net_to_gross, (0, len(latest) - len(net_to_gross)), constant_values=1.0)
            elif len(net_to_gross) > len(latest):
                net_to_gross = net_to_gross[:len(latest)]
        ult_net_disc_vec = [
            latest[i] + (cum_trian[i] - latest[i]) * net_to_gross[i]
            for i in range(len(latest))
        ]
        cum_trian_minus_latest = [
            cum_trian[i] - latest[i]
            for i in range(len(latest))
        ]
        ult_net_disc_minus_latest = [
            ult_net_disc_vec[i] - latest[i]
            for i in range(len(latest))
        ]
        last_col_minus_latest = [
            last_col[i] - latest[i]
            for i in range(len(latest))
        ]

        return {
            "last_col": last_col,
            "latest": latest,
            "cum_trian": cum_trian,
            "ult_net_disc": ult_net_disc_vec,
            "last_col_minus_latest": last_col_minus_latest,
            "cum_trian_minus_latest": cum_trian_minus_latest,
            "ult_net_disc_minus_latest": ult_net_disc_minus_latest,
        }

    def triangle_forward_incurred_change(self, data, data_paid, f, lr, r_j, exposure, k_change, discount_factors, net_to_gross):
        data = data.copy()
        mm, nn = data.shape
        lr = lr[1:]
     #   r_j[11] = 0.999721251378891
        latest = self.vector_reverse_diagonal_to_script(data_paid)
        base_col = data_paid[:, 0].copy()
        #r_j[12:] = [1] * (len(r_j) - 12)
        if len(f) or len(lr) > mm:
            pad_width = int(np.max([len(lr)-1, len(f)])) + 1 - nn
            if pad_width > 0:
                data = np.hstack((data, np.full((mm, pad_width), np.nan)))
                data_paid = np.hstack((data_paid, np.full((mm, pad_width), np.nan)))
        index_calc = int(np.max([len(lr)-1, len(f)]))
        for j in range(0, index_calc):
            max_ind_row = max(0, mm - j - 1)
            for i in range(max_ind_row, mm):
                if j < k_change:
                    data[i, j + 1] = (data[i, j] + exposure[i] * lr[j+1]) 
                    data_paid[i, j + 1] = data[i, j+1] *r_j[j+1]
                else:
                    data[i, j + 1] = data[i, j] * f[j] 
                    data_paid[i, j + 1] = data[i, j+1] *r_j[j+1]

        cols_tmp = data_paid.shape[1]

        last_col = data_paid[:, -1].copy()
        tri_proj = np.full((mm, cols_tmp + 1), np.nan)
        tri_proj[:, 0] = base_col
        tri_proj[:, 1:] = data_paid

        inc_proj = tri_proj[:, 1:] - tri_proj[:, :-1]
        inc_proj[:, 0] = base_col


        if discount_factors is None or len(discount_factors) == 0:
            discount_factors = np.ones(cols_tmp, dtype=float)
        else:
            discount_factors = np.asarray(discount_factors, dtype=float)

        for rr in range(mm - 1, -1, -1):
            offset = mm - 1 - rr
            for cc in range(offset + 1, inc_proj.shape[1]):
                idx = cc - (offset + 1)
                if idx < len(discount_factors) and not np.isnan(inc_proj[rr, cc]):
                    inc_proj[rr, cc] /= discount_factors[idx]


        cum_trian = np.nansum(inc_proj, axis=1)

        if net_to_gross is None or len(net_to_gross) == 0:
            net_to_gross = np.ones_like(latest, dtype=float)
        else:
            net_to_gross = np.asarray(net_to_gross, dtype=float)
            if len(net_to_gross) < len(latest):
                net_to_gross = np.pad(net_to_gross, (0, len(latest) - len(net_to_gross)), constant_values=1.0)
            elif len(net_to_gross) > len(latest):
                net_to_gross = net_to_gross[:len(latest)]
        ult_net_disc_vec = [
            latest[i] + (cum_trian[i] - latest[i]) * net_to_gross[i]
            for i in range(len(latest))
        ]
        cum_trian_minus_latest = [
            cum_trian[i] - latest[i]
            for i in range(len(latest))
        ]
        ult_net_disc_minus_latest = [
            ult_net_disc_vec[i] - latest[i]
            for i in range(len(latest))
        ]
        last_col_minus_latest = [
            last_col[i] - latest[i]
            for i in range(len(latest))
        ]
        return {
            "last_col": last_col,
            "latest": latest,
            "cum_trian": cum_trian,
            "ult_net_disc": ult_net_disc_vec,
            "last_col_minus_latest": last_col_minus_latest,
            "cum_trian_minus_latest": cum_trian_minus_latest,
            "ult_net_disc_minus_latest": ult_net_disc_minus_latest,
        }

#####
