@staticmethod
def calculate_sigma(
    p_ij: pd.DataFrame,
    l_ij: pd.DataFrame,
    w_ij: pd.DataFrame,
    dev_j: list[float]
) -> list[float]:

    max_col = l_ij.shape[1]

    # UWAGA:
    # sigmas przechowuje sigma^2,
    # tak jak w Twoim dotychczasowym kodzie.
    sigmas = []

    sd = []

    for j in range(max_col):

        numerator = 0.0
        denominator = 0.0
        denominator_sd = 0.0

        for i in range(len(l_ij)):

            try:
                w = w_ij.iloc[i, j]
                p = p_ij.iloc[i, j]
                l = l_ij.iloc[i, j]
                dev = dev_j[j]

                if (
                    not np.isnan(w)
                    and not np.isnan(p)
                    and not np.isnan(l)
                ):

                    numerator += (
                        w
                        * p
                        * (l - dev) ** 2
                    )

                    denominator += w

                    denominator_sd += (
                        w * p
                    )

            except IndexError:
                continue

        # ====================================================
        # ZWYKŁE KOLUMNY
        #
        # Tak jak wcześniej:
        #
        # sigma_squared = sigma^2
        # ====================================================

        if denominator > 1:

            sigma_squared = (
                numerator
                / (denominator - 1)
            )

        # ====================================================
        # OSTATNIA KOLUMNA
        #
        # Mack dokładnie jak w R,
        # ale wynik z powrotem zapisujemy jako sigma^2.
        # ====================================================

        elif (
            j == max_col - 1
            and len(sigmas) >= 2
            and sigmas[j - 2] != 0
            and denominator_sd != 0
        ):

            # sigmas zawiera sigma^2.
            #
            # Żeby przejść dokładnie przez wzór z R,
            # odtwarzamy najpierw sigma.

            sigma_prev_2 = np.sqrt(
                sigmas[j - 2]
            )

            sigma_prev_1 = np.sqrt(
                sigmas[j - 1]
            )

            # R:
            #
            # ratio =
            # sigma[i-1]^4 / sigma[i-2]^2

            ratio = (
                sigma_prev_1 ** 4
                / sigma_prev_2 ** 2
            )

            if (
                np.isnan(ratio)
                or np.isinf(ratio)
            ):

                sigma_last = np.sqrt(
                    abs(
                        min(
                            sigma_prev_2 ** 2,
                            sigma_prev_1 ** 2
                        )
                    )
                )

            else:

                sigma_last = np.sqrt(
                    abs(
                        min(
                            ratio,
                            min(
                                sigma_prev_2 ** 2,
                                sigma_prev_1 ** 2
                            )
                        )
                    )
                )

            # =================================================
            # WAŻNE:
            #
            # R ma tutaj sigma.
            #
            # Twój dalszy kod oczekuje sigma^2,
            # więc kwadratujemy TYLKO przed zapisaniem.
            # =================================================

            sigma_squared = (
                sigma_last ** 2
            )

        else:

            sigma_squared = 0.0

        # ====================================================
        # ZACHOWUJEMY DOTYCHCZASOWY FORMAT
        # ====================================================

        sigmas.append(
            sigma_squared
        )

        if denominator_sd != 0:

            sd.append(
                sigma_squared
                / denominator_sd
            )

        else:

            sd.append(
                0.0
            )

    return [
        sigmas,
        sd
    ]
